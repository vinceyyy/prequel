# RAG System Implementation Exercise

## Welcome! 👋

You'll be implementing a **Retrieval-Augmented Generation (RAG) system** for a technical documentation search assistant.
This is a practical coding exercise designed to assess your hands-on experience with GenAI systems.

## What You'll Build

A complete RAG pipeline that:

- **Retrieves** relevant documents from a knowledge base using semantic search
- **Generates** contextual responses using retrieved information
- **Provides** source attribution for transparency

Think of it as building a smart documentation assistant that can answer questions by finding relevant information and
synthesizing helpful responses.

## Project Structure

```
rag_interview/
├── README.md               # This file
├── requirements.txt        # Python dependencies
├── data/
│   ├── documents.json      # Sample knowledge base (5 ML/AI docs)
│   └── embeddings.pkl      # Pre-computed document embeddings
├── src/
│   ├── __init__.py
│   ├── rag_system.py       # Main RAG orchestrator (YOU IMPLEMENT)
│   ├── retriever.py        # Document retrieval logic (YOU IMPLEMENT)
│   └── generator.py        # Response generation (YOU IMPLEMENT)
└── main.py                 # Demo script to run your system
```

## What's Already Set Up

✅ **Environment**: Python packages installed, OpenAI API configured  
✅ **Data**: 5 technical documents with pre-computed embeddings  
✅ **Structure**: Starter code with clear class definitions and TODOs  
✅ **Testing**: Demo script ready to test your implementation

## Your Mission (45 minutes)

### Phase 1: Core Implementation (25 min)

**Goal**: Get the basic RAG pipeline working

1. **Complete `DocumentRetriever`** (`src/retriever.py`)
    - Implement semantic search using cosine similarity
    - Return top-k most relevant documents with scores

2. **Complete `ResponseGenerator`** (`src/generator.py`)
    - Design effective prompts for OpenAI API
    - Handle API calls with proper error handling
    - Structure responses with source attribution

3. **Complete `RAGSystem`** (`src/rag_system.py`)
    - Connect retriever and generator components
    - Implement the main `search_and_generate()` pipeline
    - Format context appropriately for generation

### Phase 2: Enhancement (15 min)

**Goal**: Add one or two improvements (choose what interests you most)

- **Query Enhancement**: Preprocess queries for better retrieval
- **Relevance Filtering**: Set minimum similarity thresholds
- **Response Post-processing**: Clean up generated responses
- **Caching**: Cache responses for repeated queries
- **Better Prompting**: More sophisticated prompt engineering

### Phase 3: Testing & Discussion (5 min)

**Goal**: Validate your implementation and discuss improvements

- Run the demo script with test queries
- Debug any issues
- Discuss production considerations

## Getting Started

1. **Run the demo** to see the expected interface (click the `run` button or use terminal):
   ```bash
   python3 main.py
   ```

2. **Check the starter code** - each file has clear TODOs and docstrings

3. **Start with retriever** - implement document search first, then generation

## Key Technical Notes

- **Embeddings**: Pre-computed using `sentence-transformers` model `all-MiniLM-L6-v2`
- **Similarity**: Use cosine similarity for document retrieval
- **API**: OpenAI client is configured and ready to use
- **Error Handling**: Consider edge cases like empty queries, API failures
- **Response Format**: Return structured data with both response and sources

## Tips for Success

🎯 **Focus on functionality first** - get basic retrieval and generation working  
🔍 **Test as you go** - run queries to validate each component  
💬 **Think out loud** - explain your approach and decisions  
🚀 **Prioritize** - tackle the most important parts first given time constraints  
🤝 **Ask questions** - clarify requirements if anything is unclear

## Evaluation Areas

We're looking at:

- **Technical implementation**: Clean, working code
- **Problem-solving approach**: How you tackle the challenge
- **GenAI understanding**: Knowledge of RAG concepts and best practices
- **Communication**: How you explain your decisions and collaborate

## Need Help?

- Check the docstrings in starter code for implementation hints
- The `main.py` script shows expected input/output format
- Don't hesitate to ask clarifying questions!

---

**Ready to start?** Take a moment to explore the codebase, then dive into the implementation. Good luck! 🚀