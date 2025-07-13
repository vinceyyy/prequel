import numpy as np
from sentence_transformers import SentenceTransformer


class DocumentRetriever:
    def __init__(self, documents: list, embeddings: np.ndarray):
        """
        Initialize retriever with documents and embeddings.
        """
        self.documents = documents
        self.embeddings = embeddings
        self.encoder = SentenceTransformer("all-MiniLM-L6-v2")

    def retrieve(self, query: str, top_k: int = 3) -> list:
        """
        Retrieve top-k most relevant documents for the query.

        TODO: Implement retrieval logic
        1. Encode the query
        2. Compute similarities with document embeddings
        3. Return top-k documents with scores
        """
        pass

    def _compute_similarity(self, query_embedding: np.ndarray) -> np.ndarray:
        """
        Compute cosine similarity between query and document embeddings.

        TODO: Implement similarity computation
        """
        pass
