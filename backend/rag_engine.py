import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings
from langchain_core.documents import Document

from backend.config import settings


class RAGEngine:
    """
    RAG engine backed by ChromaDB and orchestrated by LangChain.

    Public API (unchanged from the SQLite-based version):
        - add_resolved_incident(number, short_description, resolution, resolved_by)
        - search_similar_incidents(query, top_k=2) -> list of dicts
        - get_all_resolved_incidents() -> list of dicts (used by /api/history)
        - seed_historical_incidents(seed_list) -> bulk-loads historical KB

    Storage: ChromaDB collection at settings.CHROMA_PERSIST_DIR / settings.CHROMA_COLLECTION_NAME.
    Embeddings: settings.OLLAMA_EMBED_MODEL via langchain_community.embeddings.OllamaEmbeddings.
    """

    def __init__(self):
        # 1. LangChain embedding function wrapping the local Ollama model
        self.embeddings = OllamaEmbeddings(
            model=settings.OLLAMA_EMBED_MODEL,
            base_url=settings.OLLAMA_BASE_URL,
        )

        # 2. Persistent ChromaDB client on disk
        self.chroma_client = chromadb.PersistentClient(
            path=settings.CHROMA_PERSIST_DIR,
            settings=ChromaSettings(anonymized_telemetry=False),
        )

        # 3. LangChain Chroma vector store bound to the named collection
        self.vectorstore = Chroma(
            client=self.chroma_client,
            collection_name=settings.CHROMA_COLLECTION_NAME,
            embedding_function=self.embeddings,
        )

    # ---------- write paths ----------

    def add_resolved_incident(
        self,
        number: str,
        short_description: str,
        resolution: str,
        resolved_by: str,
    ) -> None:
        """
        Indexes a freshly resolved incident into ChromaDB so future similar
        incidents can match against it.
        """
        text = f"{short_description} {resolution}"
        metadata = {
            "number": number,
            "short_description": short_description,
            "resolution": resolution,
            "resolved_by": resolved_by,
        }
        # Use the incident number as the doc id so re-resolving the same
        # ticket doesn't create duplicate embeddings.
        doc = Document(page_content=text, metadata=metadata, id=number)
        self.vectorstore.add_documents([doc])
        print(f"Added resolved incident {number} to RAG (ChromaDB).")

    def seed_historical_incidents(self, historical_tickets: list) -> None:
        """
        Bulk-loads the historical seed list into ChromaDB on first startup.
        Skips if the collection already has documents (idempotent across restarts).
        """
        existing = self.chroma_client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION_NAME
        )
        if existing.count() > 0:
            print(
                f"ChromaDB collection already has {existing.count()} docs; "
                "skipping seed."
            )
            return

        print(
            f"Seeding {len(historical_tickets)} historical resolved incidents "
            "into ChromaDB..."
        )
        documents = []
        for ticket in historical_tickets:
            text = f"{ticket['short_description']} {ticket['resolution']}"
            metadata = {
                "number": ticket["number"],
                "short_description": ticket["short_description"],
                "resolution": ticket["resolution"],
                "resolved_by": ticket["resolved_by"],
            }
            documents.append(
                Document(page_content=text, metadata=metadata, id=ticket["number"])
            )
        self.vectorstore.add_documents(documents)
        print("Historical incidents seeded into ChromaDB successfully.")

    # ---------- read paths ----------

    def search_similar_incidents(
        self, incident_description: str, top_k: int = 2
    ) -> list:
        """
        Returns the top_k most similar resolved incidents for the given query.
        Each result is a dict with the same shape the assignment engine expects:
            { number, short_description, resolution, resolved_by, similarity_score }
        """
        try:
            # langchain_chroma's Chroma uses L2 (squared) distance by default.
            # `similarity_search_with_score` returns (Document, distance) pairs
            # where LOWER distance = MORE similar. We convert to a 0..100
            # similarity score with: 100 / (1 + distance).
            hits = self.vectorstore.similarity_search_with_score(
                incident_description, k=top_k
            )

            results = []
            for doc, distance in hits:
                d = max(0.0, float(distance))
                # Monotonic mapping: distance 0 -> 100, distance 1 -> 50, etc.
                sim_pct = 100.0 / (1.0 + d)
                results.append({
                    "number": doc.metadata.get("number", ""),
                    "short_description": doc.metadata.get("short_description", ""),
                    "resolution": doc.metadata.get("resolution", ""),
                    "resolved_by": doc.metadata.get("resolved_by", ""),
                    "similarity_score": round(sim_pct, 2),
                })
            return results
        except Exception as e:
            print(f"Error during vector search: {e}")
            return self.keyword_search_fallback(incident_description, top_k)

    def get_all_resolved_incidents(self) -> list:
        """
        Returns every indexed resolved incident (used by /api/history).
        Pulls all metadata back from ChromaDB in one call.
        """
        data = self.vectorstore.get()  # {ids, metadatas, documents, embeddings}
        ids = data.get("ids", []) or []
        metadatas = data.get("metadatas", []) or []
        out = []
        for doc_id, meta in zip(ids, metadatas):
            entry = {"id": doc_id, **(meta or {})}
            out.append(entry)
        return out

    def keyword_search_fallback(self, query: str, top_k: int) -> list:
        """
        Metadata-only keyword search against ChromaDB. Used when the
        embedding service is unavailable so the RAG pipeline still returns
        something useful instead of nothing.

        ChromaDB >=0.5 does NOT support substring matching on string
        metadata (`$contains` is silently ignored), so we always pull the
        full collection and filter client-side. We score each match by the
        number of unique query tokens it contains so the results at least
        correlate with the query.
        """
        print("Embedding service unavailable. Falling back to keyword search...")
        tokens = [w.strip().lower() for w in query.split() if len(w) > 3]
        collection = self.chroma_client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION_NAME
        )

        # Pull all rows once. Empty collection -> nothing to return.
        try:
            res = collection.get()
        except Exception as e:
            print(f"Keyword fallback: collection.get() failed: {e}")
            return []
        ids = res.get("ids", []) or []
        metas = res.get("metadatas", []) or []
        if not ids:
            return []

        scored = []  # (score, number, short_description, resolution, resolved_by)
        for doc_id, meta in zip(ids, metas):
            meta = meta or {}
            sd = (meta.get("short_description") or "").lower()
            rs = (meta.get("resolution") or "").lower()
            haystack = f"{sd} {rs}"
            # Count how many tokens appear at least once; ties broken by
            # total token occurrences so "oracle oracle" beats "oracle".
            unique_hits = sum(1 for t in tokens if t in haystack)
            if unique_hits <= 0:
                continue
            total_hits = sum(haystack.count(t) for t in tokens)
            scored.append((unique_hits, total_hits, {
                "number": meta.get("number", doc_id),
                "short_description": meta.get("short_description", ""),
                "resolution": meta.get("resolution", ""),
                "resolved_by": meta.get("resolved_by", ""),
            }))

        # Best matches first; if nothing matched, return the most recent rows
        # (Chroma's insertion order) so the caller at least gets something.
        if scored:
            scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
            rows = [
                {**r, "similarity_score": 50.0} for _, _, r in scored[:top_k]
            ]
            return rows

        rows = []
        for doc_id, meta in zip(ids, metas):
            meta = meta or {}
            rows.append({
                "number": meta.get("number", doc_id),
                "short_description": meta.get("short_description", ""),
                "resolution": meta.get("resolution", ""),
                "resolved_by": meta.get("resolved_by", ""),
                "similarity_score": 50.0,
            })
            if len(rows) >= top_k:
                break
        return rows


rag_engine = RAGEngine()
