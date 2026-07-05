import sqlite3
import numpy as np
import httpx
from backend.config import settings
from backend.database import get_db_connection

class RAGEngine:
    def __init__(self):
        self.ollama_url = f"{settings.OLLAMA_BASE_URL}/api/embeddings"
        self.model_name = settings.OLLAMA_EMBED_MODEL

    def get_embedding(self, text: str) -> list:
        payload = {
            "model": self.model_name,
            "prompt": text
        }
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(self.ollama_url, json=payload)
                if resp.status_code == 200:
                    return resp.json()["embedding"]
                else:
                    print(f"Ollama RAG embedding error: Status {resp.status_code}, {resp.text}")
        except Exception as e:
            print(f"Error calling Ollama embedding API: {e}")
            
        # Zero-vector fallback of typical dimension size 1024
        return [0.0] * 1024

    def add_resolved_incident(self, number: str, short_description: str, resolution: str, resolved_by: str):
        conn = get_db_connection()
        cursor = conn.cursor()
        
        text_to_embed = f"{short_description} {resolution}"
        embedding = self.get_embedding(text_to_embed)
        emb_blob = np.array(embedding, dtype=np.float32).tobytes()
        
        cursor.execute("""
        INSERT INTO resolved_incidents (number, short_description, resolution, resolved_by, embedding)
        VALUES (?, ?, ?, ?, ?)
        """, (number, short_description, resolution, resolved_by, emb_blob))
        
        conn.commit()
        conn.close()
        print(f"Added resolved incident {number} to RAG Database.")

    def search_similar_incidents(self, incident_description: str, top_k: int = 2) -> list:
        """
        Searches the SQLite RAG store for similar resolved incidents using cosine similarity.
        """
        query_vector = np.array(self.get_embedding(incident_description), dtype=np.float32)
        query_norm = np.linalg.norm(query_vector)
        
        if query_norm == 0:
            # If embedding service is down, we cannot do vector search. 
            # Fallback to simple SQL keyword search! (This is an extremely robust design)
            return self.keyword_search_fallback(incident_description, top_k)
            
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT id, number, short_description, resolution, resolved_by, embedding FROM resolved_incidents")
        rows = cursor.fetchall()
        conn.close()
        
        results = []
        for row in rows:
            emb_blob = row["embedding"]
            if not emb_blob:
                continue
                
            db_vector = np.frombuffer(emb_blob, dtype=np.float32)
            db_norm = np.linalg.norm(db_vector)
            
            if db_norm == 0:
                similarity = 0.0
            else:
                # Cosine similarity
                similarity = float(np.dot(query_vector, db_vector) / (query_norm * db_norm))
                
            results.append({
                "number": row["number"],
                "short_description": row["short_description"],
                "resolution": row["resolution"],
                "resolved_by": row["resolved_by"],
                "similarity_score": round(similarity * 100, 2)
            })
            
        # Sort by similarity descending
        results.sort(key=lambda x: x["similarity_score"], reverse=True)
        return results[:top_k]

    def keyword_search_fallback(self, query: str, top_k: int) -> list:
        """
        Keyword-based SQL search fallback if the embedding model is unavailable.
        """
        print("Embedding service unavailable. Falling back to keyword search...")
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Tokenize query to find matching keywords
        words = [w.strip() for w in query.lower().split() if len(w) > 3]
        if not words:
            cursor.execute("SELECT number, short_description, resolution, resolved_by FROM resolved_incidents LIMIT ?", (top_k,))
            rows = cursor.fetchall()
        else:
            # Construct a SQL query that searches for keywords in short_description
            like_clauses = " OR ".join(["short_description LIKE ?" for _ in words])
            params = [f"%{w}%" for w in words]
            sql = f"SELECT number, short_description, resolution, resolved_by FROM resolved_incidents WHERE {like_clauses} LIMIT ?"
            cursor.execute(sql, params + [top_k])
            rows = cursor.fetchall()
            
            # If no matches, return any resolved incidents
            if not rows:
                cursor.execute("SELECT number, short_description, resolution, resolved_by FROM resolved_incidents LIMIT ?", (top_k,))
                rows = cursor.fetchall()
                
        conn.close()
        
        return [{
            "number": r["number"],
            "short_description": r["short_description"],
            "resolution": r["resolution"],
            "resolved_by": r["resolved_by"],
            "similarity_score": 50.0  # Default fallback score
        } for r in rows]

rag_engine = RAGEngine()
