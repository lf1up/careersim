# CareerSim Frontend

> [!WARNING]
> **DEPRECATED — no longer maintained.**
>
> This Vite + React SPA has been superseded by [`web/`](../web) (Next.js 15 App Router, RSC, SSE streaming against `api/`). New UI work ships in `web/` only. This directory is kept **for reference and component porting** during the migration and will be removed in a future clean-up.
>
> - **Replacement:** [`web/`](../web)
> - **Status:** commented out in `docker-compose.local.yml`; do not re-enable.
> - **Do not add new features here.** Port components into `web/src/components/` instead.

A React TypeScript frontend for the CareerSim professional simulation platform, featuring a retro-themed UI with dark mode support.

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.0.0

## Quick Start

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Start the development server:**
   ```bash
   pnpm dev
   ```

The frontend will run on `http://localhost:3000` by default.

## Environment Configuration

Copy `.env.example` to `.env` and configure the following variables:

- `VITE_PORT=3000` -- Frontend port
- `VITE_API_URL=http://localhost:8000/api` -- Backend API URL
- `VITE_SOCKET_URL=http://localhost:8000` -- Socket.IO server URL

## Available Scripts

- `pnpm dev` -- Start development server
- `pnpm build` -- Build for production (TypeScript compile + Vite build)
- `pnpm lint` -- Check for linting errors
- `pnpm preview` -- Preview production build
- `pnpm security` -- Run security-focused lint rules

## Tech Stack

- **React 18** with TypeScript
- **React Router 6** for routing
- **Tailwind CSS** for styling (retro theme with dark mode)
- **Vite** for bundling and dev server
- **Axios** for HTTP requests
- **Socket.IO Client** for real-time messaging
- **React Hot Toast** for notifications
- **React Hook Form + Yup** for form handling and validation
- **React Markdown** for rendering markdown content

## Project Structure

```
src/
├── components/
│   ├── auth/
│   │   ├── AdminRoute.tsx       # Admin role guard
│   │   ├── LoginForm.tsx        # Login page
│   │   └── RegisterForm.tsx     # Registration page
│   ├── layout/
│   │   ├── AdminLayout.tsx      # Admin panel layout with sidebar
│   │   └── Navbar.tsx           # Main navigation bar
│   └── ui/
│       ├── Button.tsx           # Base button component
│       ├── LoadingSpinner.tsx   # Loading indicator
│       ├── MarkdownMessage.tsx  # Markdown renderer for chat messages
│       ├── RetroBadge.tsx       # Retro-styled badge
│       ├── RetroButton.tsx      # Retro-styled button
│       ├── RetroCard.tsx        # Retro-styled card
│       ├── RetroDialog.tsx      # Retro-styled modal dialog
│       ├── RetroInput.tsx       # Retro-styled input field
│       ├── RetroPanel.tsx       # Retro-styled panel container
│       ├── RetroTable.tsx       # Retro-styled data table
│       ├── ThemeToggle.tsx      # Light/dark mode toggle
│       └── ValueText.tsx        # Value display component
├── contexts/
│   ├── AuthContext.tsx           # Authentication state and API
│   ├── SocketContext.tsx         # Socket.IO connection management
│   └── ThemeContext.tsx          # Dark/light theme management
├── pages/
│   ├── Dashboard.tsx            # User dashboard (home)
│   ├── Simulations.tsx          # Simulation library/gallery
│   ├── SimulationDetail.tsx     # Simulation detail + live chat session
│   ├── Sessions.tsx             # User's session history
│   ├── SessionDetail.tsx        # Session review with analytics
│   ├── Analytics.tsx            # Performance analytics overview
│   ├── Profile.tsx              # User profile settings
│   └── admin/
│       ├── AdminDashboard.tsx   # Admin overview with metrics
│       ├── AdminUsers.tsx       # User management
│       ├── AdminSimulations.tsx # Simulation content management
│       ├── AdminPersonas.tsx    # AI persona management
│       ├── AdminAnalytics.tsx   # Platform analytics
│       ├── AdminExport.tsx      # Data export tools
│       └── AdminSystem.tsx      # System configuration
├── types/
│   └── index.ts                 # TypeScript type definitions
├── utils/
│   ├── api.ts                   # Axios API client with auth interceptor
│   ├── badges.ts                # Badge/achievement utilities
│   └── sessionStatus.tsx        # Session status display helpers
├── index.css                    # Global styles and Tailwind imports
├── index.tsx                    # App entry point
└── App.tsx                      # Root component with routing
```

## Routes

### Public Routes
- `/login` -- Login page
- `/register` -- Registration page

### Protected Routes (authenticated users)
- `/dashboard` -- User home dashboard
- `/simulations` -- Browse simulation library
- `/simulations/:id` -- Simulation detail and chat
- `/simulations/:id/session/:sessionId` -- Resume existing session
- `/sessions` -- Session history
- `/sessions/:id` -- Session review
- `/analytics` -- Performance analytics
- `/profile` -- User profile

### Admin Routes (admin role required)
- `/admin` -- Admin dashboard
- `/admin/users` -- User management
- `/admin/simulations` -- Simulation management
- `/admin/personas` -- Persona management
- `/admin/analytics` -- Platform analytics
- `/admin/export` -- Data export
- `/admin/system` -- System configuration

## Development

Make sure the backend server is running on `http://localhost:8000` before starting the frontend development server.

The frontend will proxy API requests to the backend during development.

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
