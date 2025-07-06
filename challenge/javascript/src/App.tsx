import React, { useState } from 'react'
import './App.css'

// TODO: Implement a todo list application
// Requirements:
// 1. Add new todos
// 2. Mark todos as complete/incomplete
// 3. Delete todos
// 4. Filter todos (all, active, completed)

interface Todo {
  id: number
  text: string
  completed: boolean
}

function App() {
  const [todos, setTodos] = useState<Todo[]>([
    { id: 1, text: 'Learn React', completed: false },
    { id: 2, text: 'Build awesome apps', completed: false }
  ])

  // TODO: Implement these functions
  const addTodo = (text: string) => {
    // Your implementation here
  }

  const toggleTodo = (id: number) => {
    // Your implementation here
  }

  const deleteTodo = (id: number) => {
    // Your implementation here
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>Todo List Challenge</h1>
        <p>Implement the missing functionality below:</p>
        
        {/* TODO: Add input form for new todos */}
        
        {/* TODO: Display todos list */}
        <ul>
          {todos.map(todo => (
            <li key={todo.id}>
              <span style={{ textDecoration: todo.completed ? 'line-through' : 'none' }}>
                {todo.text}
              </span>
              {/* TODO: Add toggle and delete buttons */}
            </li>
          ))}
        </ul>
        
        {/* TODO: Add filter buttons (All, Active, Completed) */}
      </header>
    </div>
  )
}

export default App