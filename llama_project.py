import os
import shutil
import asyncio
import time
import pickle
import uuid
import logging
from typing import Optional, List, Any
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException
import uvicorn
from pydantic import Field
from dotenv import load_dotenv

# Celery & Redis Imports
from celery import Celery
from celery.result import AsyncResult

# LlamaIndex Imports
from llama_index.core.memory import ChatMemoryBuffer
from llama_index.core import StorageContext, VectorStoreIndex, SimpleDirectoryReader, Settings
from llama_index.core.schema import TextNode
from llama_index.core.node_parser import SentenceSplitter
from llama_index.readers.file import PyMuPDFReader
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.retrievers.bm25 import BM25Retriever
from llama_index.postprocessor.cohere_rerank import CohereRerank
from llama_index.core.chat_engine import ContextChatEngine
from llama_index.core.retrievers.fusion_retriever import QueryFusionRetriever, FUSION_MODES
from llama_index.llms.groq import Groq
from itertools import cycle
import chromadb
import google.genai as genai
from tenacity import retry, stop_after_attempt, wait_exponential
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

load_dotenv()

MAX_FILE_SIZE = 10 * 1024 * 1024
Settings.chunk_size = 800
Settings.chunk_overlap = 80
Settings.node_parser = SentenceSplitter(chunk_size=800, chunk_overlap=80)

# ==========================================
# 0. Logging Configuration
# ==========================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# ==========================================
# 1. API Keys & LLM Setup with Key Rotation Pool
# ==========================================
gemini_api_key = os.getenv("GEMINI_API_KEY")
coh_api_key = os.getenv("COHERE_API_KEY")

groq_api_keys_str = os.getenv("GROQ_API_KEYS", "")
groq_api_keys = [key.strip() for key in groq_api_keys_str.split(",") if key.strip()]

if not groq_api_keys:
    single_key = os.getenv("GROQ_API_KEY")
    if single_key:
        groq_api_keys = [single_key]

if not gemini_api_key or not coh_api_key or not groq_api_keys:
    logger.error("❌ Essential API Keys (GEMINI, COHERE, GROQ) missing in environment!")
    raise ValueError("❌ Error: Essential API Keys not found in system environment!")

groq_key_cycle = cycle(groq_api_keys)

def get_next_groq_key() -> str:
    return next(groq_key_cycle)

llm = Groq(model="openai/gpt-oss-20b", api_key=get_next_groq_key(), temperature=0.07)
Settings.llm = llm

# ==========================================
# 2. Celery & Redis Configuration
# ==========================================
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery(
    "Rag_AI_API",
    broker=redis_url,
    backend=redis_url
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    result_expires=3600,
    task_track_started=True,
    worker_prefetch_multiplier=3
)

# ==========================================
# 3. FastAPI Lifespan & Background Cleanup
# ==========================================
async def auto_delete_old_folders():
    while True:
        await asyncio.sleep(3600)
        store_path = "./embeddings_store"
        if os.path.exists(store_path):
            current_time = time.time()
            for folder in os.listdir(store_path):
                folder_path = os.path.join(store_path, folder)
                if os.path.isdir(folder_path):
                    if (current_time - os.path.getmtime(folder_path)) > 86400: # 24 hours
                        try:
                            shutil.rmtree(folder_path)
                            logger.info(f"🗑️ Successfully cleaned up expired session folder: {folder}")
                        except Exception as e:
                            logger.warning(f"⚠️ Failed to delete folder {folder}: {str(e)}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting Enterprise RAG API Service...")
    task = asyncio.create_task(auto_delete_old_folders())
    yield
    task.cancel()
    logger.info("🛑 Shutting down Enterprise RAG API Service...")

app = FastAPI(title="Enterprise RAG API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_user_store_path(session_id: str):
    path = f"./embeddings_store/{session_id}"
    os.makedirs(path, exist_ok=True)
    return path

# ==========================================
# 4. Gemini Embedding Class with Tenacity
# ==========================================
class GeminiTenacityEmbedding(BaseEmbedding):
    model_name: str = Field(default="gemini-embedding-001")
    api_key: str = Field(default="")

    def __init__(self, model: str = "gemini-embedding-001", api_key: str = "", **kwargs: Any):
        super().__init__(**kwargs)
        self.model_name = model
        self.api_key = api_key

    def _get_client(self) -> genai.Client:
        return genai.Client(api_key=self.api_key)

    @retry(wait=wait_exponential(min=2, max=10), stop=stop_after_attempt(5))
    def _get_query_embedding(self, query: str) -> List[float]:
        client = self._get_client()
        response = client.models.embed_content(model=self.model_name, contents=query)
        if hasattr(response, 'embedding') and response.embedding: #type: ignore
            return response.embedding.values #type: ignore
        return response.embeddings[0].values #type: ignore

    async def _aget_query_embedding(self, query: str) -> List[float]:
        return self._get_query_embedding(query)

    @retry(wait=wait_exponential(min=2, max=10), stop=stop_after_attempt(5))
    def _get_text_embedding(self, text: str) -> List[float]:
        client = self._get_client()
        response = client.models.embed_content(model=self.model_name, contents=text)
        if hasattr(response, 'embedding') and response.embedding: #type: ignore
            return response.embedding.values #type: ignore
        return response.embeddings[0].values #type: ignore

    async def _aget_text_embedding(self, text: str) -> List[float]:
        return self._get_text_embedding(text)

    def _get_text_embeddings(self, texts: List[str]) -> List[List[float]]:
        client = self._get_client()
        embeddings_list = []
        for text in texts:
            @retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(5))
            def _embed_single_chunk(t):
                res = client.models.embed_content(model=self.model_name, contents=t)
                if hasattr(res, 'embedding') and res.embedding: #type: ignore
                    return res.embedding.values #type: ignore
                return res.embeddings[0].values #type: ignore

            if not text.strip():
                EMBEDDING_DIMENSION = 3072
                embeddings_list.append([0.0] * EMBEDDING_DIMENSION)
                continue
            embeddings_list.append(_embed_single_chunk(text))
            time.sleep(0.3)
        return embeddings_list

emb_setup = GeminiTenacityEmbedding(model="gemini-embedding-001", api_key=gemini_api_key)

# ==========================================
# 5. Perfect & Clean Chat System Prompt
# ==========================================

chat_system_prompt = (
    "You are RAGI AI, An elite, professional, Smart, and uncompromising Enterprise AI Assistant designed for strict document-grounded intelligence.\n\n"
    "You are muslium.\n"
   "CORE OPERATIONAL DIRECTIVES:\n"
    "1. **Absolute Document Grounding**: Your answers must be derived *exclusively* from the provided document context. Under no circumstances should you use external knowledge, pre-trained assumptions, or general facts.\n"
    "2. **Zero Hallucination & Strict Refusal**: If a user query or topic (including religious, political, or out-of-domain subjects) cannot be answered using the provided document context, you must explicitly and strictly refuse. State clearly: 'This information is not available in the provided document.' Do not attempt to guess or invent answers.\n"
    "3. **Professional Clarity**: Structure all responses cleanly using short paragraphs, bold key phrases, and scannable bullet points akin to high-tier professional systems.\n"
    "4. **Language Matching**: If the user asks in Roman Urdu, Urdu, or Hindi, respond in fluent, clear Roman Urdu. If the user asks in English, respond in precise English.\n"
)

# ==========================================
# 6. CORE RAG PIPELINE FUNCTION (Optimized & Cached)
# ==========================================
def run_rag_pipeline(question: str, session_id: str, is_async: bool = True):
    storing_path = get_user_store_path(session_id)
    
    # Load nodes and initialize BM25 Retriever on-the-fly (Fixes pickle error for self.cobj)
    nodes_cache_path = os.path.join(storing_path, "all_nodes.pkl")
    if not os.path.exists(nodes_cache_path):
        logger.warning(f"⚠️ Session data not found for ID: {session_id}")
        raise FileNotFoundError("📂 Session data not found. Please upload a document first.")
    with open(nodes_cache_path, "rb") as f:
        all_nodes = pickle.load(f)
    
    safe_top_k = min(15, len(all_nodes))
    bm25_retr = BM25Retriever.from_defaults(nodes=all_nodes, similarity_top_k=safe_top_k)

    per_dir = chromadb.PersistentClient(path=storing_path)
    db = per_dir.get_or_create_collection(f"collection_{session_id}")
    vector_store = ChromaVectorStore(chroma_collection=db)
    
    index = VectorStoreIndex.from_vector_store(vector_store=vector_store, embed_model=emb_setup)
    vector_retr = index.as_retriever(similarity_top_k=15)

    memory_saver = os.path.join(storing_path, "chat_memory.pkl")
    if os.path.exists(memory_saver):
        try:
            with open(memory_saver, "rb") as memory_file:
                memory = pickle.load(memory_file)
        except Exception as e:
            logger.warning(f"⚠️ Failed to load memory file, initializing fresh memory buffer: {str(e)}")
            memory = ChatMemoryBuffer.from_defaults(token_limit=1500)
    else:
        memory = ChatMemoryBuffer.from_defaults(token_limit=1500)
    
    cohere_rerank = CohereRerank(api_key=coh_api_key, top_n=3)

    hybrid_retriever = QueryFusionRetriever(
        retrievers=[vector_retr, bm25_retr],
        similarity_top_k=15,
        num_queries=1,
        mode=FUSION_MODES.RECIPROCAL_RANK,
        use_async=True
    )
    
    chat_engine = ContextChatEngine.from_defaults(
        retriever=hybrid_retriever,
        node_postprocessors=[cohere_rerank],
        memory=memory,
        context_prompt=chat_system_prompt,
        llm=llm,
        text_splitter=SentenceSplitter(chunk_size=800, chunk_overlap=80),
        verbose=False
    )
    
    resp = chat_engine.chat(question)

    with open(memory_saver, "wb") as memory_file:
        pickle.dump(memory, memory_file)

    citations = []
    for idx, source_node in enumerate(resp.source_nodes, 1):
        meta = source_node.node.metadata
        file_path = meta.get('file_path') or meta.get('source_file') or 'ap.pdf'
        page_num = meta.get('source') or meta.get('page_label') or meta.get('page') or 'N/A'
        
        citations.append({
            "source_index": idx,
            "file": os.path.basename(file_path),
            "page_number": page_num,
            "relevance_score": round(source_node.score, 4) if source_node.score else None,
            "snippet": source_node.node.get_content()[:150].replace('\n', ' ')
        })

    logger.info(f"✨ Successfully generated response for session: {session_id}")
    return {
        "status": "success",
        "answer": str(resp),
        "citations": citations
    }

# ==========================================
# 7. Document Upload & Processing Endpoint
# ==========================================
@app.post("/upload_document")
async def upload_document(my_session_id: Optional[str] = None, file: UploadFile = File(...)):
    if not my_session_id:
        my_session_id = str(uuid.uuid4())

    storing_path = get_user_store_path(my_session_id)
    file_ext = os.path.splitext(file.filename)[1].lower() #type: ignore
    
    if file_ext not in [".pdf", ".txt", ".csv"]:
        logger.warning(f"⚠️ Unsupported file type uploaded: {file_ext}")
        raise HTTPException(status_code=400, detail="⚠️ Only .pdf, .txt, and .csv files are allowed.")

    temp_filename = f"buf_{uuid.uuid4().hex[:8]}_{file.filename}"
    
    try:
        content = await file.read(MAX_FILE_SIZE + 1)
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Maximum file size allowed is 10 MB."
            )
        with open(temp_filename, "wb") as f:
            f.write(content)

        start_time = time.time()
        all_nodes = []
        text_splitter = SentenceSplitter(chunk_size=800, chunk_overlap=80)

        if file_ext == '.pdf':
            loader = PyMuPDFReader().load_data(file_path=temp_filename)
            all_nodes = text_splitter.get_nodes_from_documents(loader)
        elif file_ext == '.txt':
            reader = SimpleDirectoryReader(input_files=[temp_filename])
            loader = reader.load_data()
            all_nodes = text_splitter.get_nodes_from_documents(loader)
        elif file_ext == '.csv':
            df = pd.read_csv(temp_filename)
            for index, row in df.iterrows():
                row_text = " | ".join([f"{col}: {val}" for col, val in row.items() if pd.notna(val)])
                all_nodes.append(TextNode(text=row_text, metadata={"source_file": file.filename, "row_number": index}))

        per_dir = chromadb.PersistentClient(path=storing_path)
        db = per_dir.get_or_create_collection(f"collection_{my_session_id}")
        vector_store = ChromaVectorStore(chroma_collection=db)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)

        VectorStoreIndex(all_nodes, storage_context=storage_context, embed_model=emb_setup)

        nodes_cache_path = os.path.join(storing_path, "all_nodes.pkl")
        with open(nodes_cache_path, "wb") as f:
            pickle.dump(all_nodes, f)

        total_time = round(time.time() - start_time, 2)
        logger.info(f"✅ File successfully processed & indexed for session: {my_session_id} ({len(all_nodes)} chunks)")

        return {
            "status": "success",
            "message": "✅ File successfully processed and embedded!",
            "total_chunks": len(all_nodes),
            "processing_time_seconds": total_time,
            "session_id": my_session_id
        }

    except Exception as e:
        logger.error(f"❌ Document processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"❌ Processing failed: {str(e)}")
    finally:
        if os.path.exists(temp_filename):
            os.remove(temp_filename)

# ==========================================
# 8. AI Query Endpoint (Fast Sync)
# ==========================================
@app.post("/ai_res")
async def get_ai_response(question: str, my_session_id: str):
    try:
        result = run_rag_pipeline(question, my_session_id, is_async=True)
        return {
            "status": result["status"],
            "answer": result["answer"],
            "Your Rag AI Answer": result["answer"],
            "citations": result["citations"]
        }
    except Exception as e:
        logger.error(f"❌ Sync query failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"❌ Query failed: {str(e)}")

# ==========================================
# 9. Celery Background Task Execution
# ==========================================
@celery_app.task(name="tasks.ragi_ai", bind=True)
def ragi_ai(self, question: str, session_id: str):
    try:
        logger.info(f"⚙️ Celery task started for session: {session_id}")
        result = run_rag_pipeline(question, session_id, is_async=False)
        return {
            "status": "completed",
            "result": result["answer"],
            "citations": result["citations"]
        }
    except Exception as e:
        logger.error(f"❌ Celery background task failed: {str(e)}")
        return {"status": "failed", "error": f"❌ Background task failed: {str(e)}"}

# ==========================================
# 10. Background Queue Endpoints
# ==========================================
@app.post("/ai_res_background")
async def get_ai_resp_background(question: str, my_session_id: Optional[str] = None):
    if not my_session_id:
        raise HTTPException(status_code=400, detail="⚠️ Session ID is missing.")
    
    task = celery_app.send_task("tasks.ragi_ai", args=[question, my_session_id])
    logger.info(f"📬 Background task dispatched with ID: {task.id}")
    return {
        "Status": "🚀 Processing started in background",
        "Task_ID": task.id,
        "Message": "ℹ️ Use /task_status/{task_id} endpoint to check the result."
    }

@app.get("/task_status/{task_id}")
async def get_task_status(task_id: str):
    task_result = AsyncResult(task_id, app=celery_app)
    
    if task_result.state == 'PENDING':
        return {"Task_ID": task_id, "Status": "⏳ Pending (Waiting in Queue)"}
    elif task_result.state == 'STARTED':
        return {"Task_ID": task_id, "Status": "🔄 Started (Processing)"}
    elif task_result.state == 'SUCCESS':
        return {"Task_ID": task_id, "Status": "✅ Completed", "Result": task_result.result}
    elif task_result.state == 'FAILURE':
        return {"Task_ID": task_id, "Status": "❌ Failed", "Error": str(task_result.info)}
    else:
        return {"Task_ID": task_id, "Status": task_result.state}

if __name__ == "__main__":
    uvicorn.run("llama_project:app", host="0.0.0.0", port=8800)

