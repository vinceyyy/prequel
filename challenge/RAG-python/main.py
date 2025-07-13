from src.rag_system import RAGSystem


def main():
    # Initialize RAG system
    rag = RAGSystem("data/documents.json", "data/embeddings.pkl")

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

        try:
            result = rag.search_and_generate(query)
            print(f"Response: {result.get('response', 'No response generated')}")
            print(f"Sources: {[doc['title'] for doc in result.get('sources', [])]}")
        except Exception as e:
            print(f"Error: {str(e)}")


if __name__ == "__main__":
    main()
