# Full Stack Challenge: Task Management System

## Objective
Build a task management system with the following features:

## Backend Requirements (Express.js)
1. **User Authentication**
   - User registration and login
   - JWT token-based authentication
   - Password hashing

2. **Task Management API**
   - Create, read, update, delete tasks
   - Task categories and priorities
   - Due date management
   - Task assignment to users

3. **Database Design**
   - Users table
   - Tasks table
   - Categories table
   - Proper relationships and constraints

## Frontend Requirements (React)
1. **User Interface**
   - Login/register forms
   - Task list with filtering
   - Task creation/editing modal
   - Dashboard with statistics

2. **State Management**
   - User authentication state
   - Task data management
   - Form state handling

3. **User Experience**
   - Responsive design
   - Loading states
   - Error handling
   - Real-time updates

## API Endpoints to Implement

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Tasks
- `GET /api/tasks` - Get user's tasks
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Categories
- `GET /api/categories` - Get all categories
- `POST /api/categories` - Create category

## Bonus Features
- Task search and filtering
- File attachments
- Task comments
- Email notifications
- Real-time collaboration

## Getting Started
1. Set up the backend API server
2. Create the database schema
3. Implement authentication
4. Build the task management endpoints
5. Create the React frontend
6. Connect frontend to backend
7. Add styling and UX improvements

## Time Allocation
- Backend setup: 30 minutes
- Database design: 15 minutes
- Authentication: 45 minutes
- Task API: 45 minutes
- Frontend setup: 30 minutes
- UI components: 60 minutes
- Integration: 30 minutes
- Testing & polish: 15 minutes

**Total estimated time: 4 hours**