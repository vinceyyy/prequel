from rag_system import RAGSystem, KnowledgeBase


def main():
    # Initialize Vector DB and process documents
    knowledge_base = KnowledgeBase(documents_path="data/documents.json")

    # Initialize RAG system
    rag = RAGSystem(knowledge_base=knowledge_base)

    # Test queries
    test_queries = [
        "How do I get started with machine learning?",
        "What are the best practices for deploying ML models?",
        "Explain different types of neural networks",
    ]

    print("RAG System Demo")
    print("=" * 50)

    for query in test_queries:
        print(f"\nQuery: {query}")
        print("-" * 30)

        result = rag.search_and_generate(query)
        print(f"Answer: {result.answer}")
        print(
            f"Sources: {', '.join([doc.title for doc in result.supporting_documents])}"
        )


if __name__ == "__main__":
    main()
