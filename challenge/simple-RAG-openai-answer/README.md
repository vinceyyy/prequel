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
├── rag_system.py           # RAG system with KnowledgeBase (YOU IMPLEMENT)
├── main.py                 # Demo script to run your system
└── data/
    └── documents.json      # Sample knowledge base (5 ML/AI docs)
```

## What's Already Set Up

✅ **Environment**: Python packages installed, OpenAI API configured  
✅ **Data**: 5 technical documents with pre-computed embeddings  
✅ **Structure**: Starter code with clear class definitions and TODOs  
✅ **API Integration**: OpenAI client setup and proper type handling for chat completions

## Your Mission (45 minutes)

### Phase 1: Core Implementation (30 min)

**Goal**: Get the basic RAG pipeline working

1. **Implement Document Embedding** (`KnowledgeBase._create_embeddings` method)
    - Use the provided `_embed_single_text` method to generate embeddings
    - Process all documents and store embeddings in the Document objects
    - Handle any potential errors gracefully

2. **Implement Document Retrieval** (`KnowledgeBase.retrieve_documents` method)
    - Generate embedding for the query using `_embed_single_text`
    - Compute similarity scores with all document embeddings (use dot product)
    - Return top-k most relevant documents

3. **Implement Context Formatting** (`RAGSystem._format_context` method)
    - Format retrieved documents into a coherent context string
    - Include document titles and content appropriately

4. **Improve the Prompt** (`RAGSystem._create_prompt_messages` method)
    - Enhance the basic template to use the context effectively
    - Add instructions for using source information
    - Handle cases where context might be insufficient

### Phase 2: Enhancement (10 min)

**Goal**: Add one improvement (choose what interests you most)

- **Better Context Formatting**: Improve how documents are presented to the LLM
- **Relevance Filtering**: Set minimum similarity thresholds for document inclusion
- **Error Handling**: Robust handling of edge cases and API failures
- **Prompt Engineering**: More sophisticated instructions for better responses

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

2. **Check the starter code** - The KnowledgeBase and RAGSystem classes have clear TODOs and method stubs

3. **Start with embeddings** - implement document embedding first, then retrieval, then context formatting

## More Sample Queries to Test

```
"How do I get started with machine learning?"
"What are the best practices for deploying ML models?"
"Explain different types of neural networks"
"How should I preprocess text data?"
```

## Tips for Success

🎯 **Focus on the data flow** - understand how documents → embeddings → retrieval → context → generation works  
🔍 **Test incrementally** - implement one method at a time and test with print statements  
💬 **Think about the user experience** - what makes a good RAG response?  
🚀 **Prioritize working functionality** - get basic retrieval working before optimizing  
🤝 **Ask questions** - clarify requirements if anything is unclear

We're looking at:

- **Technical implementation**: Clean, working code that follows the existing patterns
- **Problem-solving approach**: How you tackle each component systematically
- **RAG understanding**: Knowledge of embedding similarity, context formatting, and prompt design
- **Communication**: How you explain your decisions and collaborate

## Need Help?

- Check the docstrings in starter code for implementation hints
- The `main.py` script shows expected input/output format
- Don't hesitate to ask clarifying questions!

---

**Ready to start?** Take a moment to explore the codebase, then dive into the implementation. Good luck! 🚀