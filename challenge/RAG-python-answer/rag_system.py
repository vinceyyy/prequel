from dataclasses import dataclass
from textwrap import dedent
import json
import os

import openai
import numpy as np
from openai.types.chat import (
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)

client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


@dataclass
class Document:
    """Represents a document in the knowledge base with optional embeddings."""

    id: str
    title: str
    content: str
    category: str
    embeddings: list[float] | None = None


@dataclass
class Result:
    """
    Response from the RAG system containing the generated answer and source documents.

    Attributes:
        answer (str): Generated response to the user's query
        supporting_documents (list[Document]): Documents used to generate the answer
    """

    answer: str
    supporting_documents: list[Document]


class KnowledgeBase:
    """
    Knowledge base for storing and retrieving documents using semantic similarity.

    This class handles document embedding generation and similarity-based retrieval.
    Documents are embedded using OpenAI's text-embedding-3-small model and stored
    in memory for fast similarity search.

    Attributes:
        embedding_model (str): The OpenAI embedding model to use
        documents (list[Document]): List of documents with computed embeddings
    """

    def __init__(self, documents_path: str):
        self.embedding_model = "text-embedding-3-small"

        with open(documents_path, "r") as file:
            raw_documents = [
                Document(
                    id=doc["id"],
                    title=doc["title"],
                    content=doc["content"],
                    category=doc["category"],
                )
                for doc in json.load(file)
            ]

        # TODO: The function below needs to be implemented
        self.documents = self._create_embeddings(documents=raw_documents)

    def _embed_single_text(self, text: str) -> list[float]:
        """Get embeddings for text using OpenAI API."""
        response = client.embeddings.create(input=text, model=self.embedding_model)
        return response.data[0].embedding

    def _create_embeddings(self, documents: list[Document]) -> list[Document]:
        """
        Compute embeddings for all documents.

        TODO: Implement creating embeddings for all documents with self._embed_single_text() above
        """
        return [
            Document(
                id=doc.id,
                title=doc.title,
                content=doc.content,
                category=doc.category,
                embeddings=self._embed_single_text(doc.content),
            )
            for doc in documents
        ]

    def retrieve_documents(self, query: str, top_k: int = 3) -> list[Document]:
        """
        Retrieve top-k most relevant documents for the query.

        TODO: Implement retrieval logic
        Hint: Use dot product np.dot(a, b) for normalized embeddings
        """
        query_embeddings = self._embed_single_text(query)
        similarities = [
            (np.dot(query_embeddings, doc.embeddings), doc) for doc in self.documents
        ]

        top_results = sorted(similarities, key=lambda x: x[0], reverse=True)[:top_k]

        return [n[1] for n in top_results]


class RAGSystem:
    """
    Retrieval-Augmented Generation system for answering questions using document context.

    This system combines semantic search with language generation to provide accurate,
    context-aware responses. It retrieves relevant documents from a knowledge_base
    and uses them to augment prompts for better answer generation.

    Attributes:
        chat_model (str): The OpenAI chat model to use for generation
        knowledge_base (KnowledgeBase): knowledge_base for document retrieval
    """

    def __init__(self, knowledge_base: KnowledgeBase):
        """
        Initialize the RAG system with documents.
        """
        self.chat_model = "gpt-4o-mini"
        self.knowledge_base = knowledge_base

    def search_and_generate(self, query: str, top_k: int = 3) -> Result:
        """
        Main RAG pipeline: retrieve relevant documents and generate response.

        1. Retrieve top-k relevant documents using embeddings
        2. Generate response using retrieved context
        3. Return structured response with sources
        """
        related_documents = self.knowledge_base.retrieve_documents(
            query=query, top_k=top_k
        )
        context = self._format_context(retrieved_docs=related_documents)
        augmented_messages = self._create_prompt_messages(query=query, context=context)
        answer = self._generate_response(message_dicts=augmented_messages)
        return Result(answer=answer, supporting_documents=related_documents)

    def _format_context(self, retrieved_docs: list[Document]) -> str:
        """
        Format retrieved documents into context for generation.

        TODO: Implement context formatting
        """
        return "\n".join(
            [
                dedent(f"""
                    ID: {doc.id}
                    Title: {doc.title}
                    Content: {doc.title}
                """)
                for doc in retrieved_docs
            ]
        )

    def _create_prompt_messages(self, query: str, context: str) -> list[dict[str, str]]:
        """
        Create messages for the chat completion API.

        TODO: Improve the starting template below
        """
        messages = [
            {
                "role": "system",
                "content": "You are a helpful technical documentation assistant. Answer questions using only the provided context. If the context doesn't contain enough information to answer the question, say so clearly. Keep responses concise but complete.",
            },
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {query}\n\nPlease provide a helpful answer based on the context above.",
            },
        ]
        return messages

    def _generate_response(self, message_dicts: list[dict[str, str]]) -> str:
        """Generate response using query and retrieved context."""
        messages: list[ChatCompletionMessageParam] = []
        for message_dict in message_dicts:
            if message_dict["role"] == "system":
                messages.append(
                    ChatCompletionSystemMessageParam(
                        role="system", content=message_dict["content"]
                    )
                )
            elif message_dict["role"] == "user":
                messages.append(
                    ChatCompletionUserMessageParam(
                        role="user", content=message_dict["content"]
                    )
                )

        try:
            response = client.chat.completions.create(
                model=self.chat_model,
                messages=messages,
                max_tokens=500,
                temperature=0.7,
            )

            return response.choices[0].message.content.strip()

        except Exception as e:
            return f"Error generating response: {str(e)}"
