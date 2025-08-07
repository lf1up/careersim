# CareerSim Frontend

A React TypeScript frontend for the CareerSim professional simulation platform.

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

- `VITE_PORT=3000` - Frontend port (default React port)
- `VITE_API_URL=http://localhost:8000/api` - Backend API URL
- `VITE_SOCKET_URL=http://localhost:8000` - Socket.IO server URL

## Available Scripts

- `pnpm dev` - Start development server
- `pnpm start` - Start development server (alias for dev)
- `pnpm build` - Build for production
- `pnpm lint` - Check for linting errors
- `pnpm security` - Check for security issues

## Tech Stack

- **React 18** with TypeScript
- **React Router** for routing
- **Tailwind CSS** for styling
- **Axios** for HTTP requests
- **Socket.IO Client** for real-time communication
- **React Hot Toast** for notifications
- **React Hook Form** for form handling

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── auth/           # Authentication components
│   ├── layout/         # Layout components
│   └── ui/             # Base UI components
├── contexts/           # React contexts
├── pages/              # Page components
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
└── App.tsx             # Main app component
```

## API Integration

The frontend integrates with the CareerSim backend API for:

- User authentication and registration
- Simulation management
- Session handling
- Real-time messaging
- Performance analytics
- Subscription management

## Development

Make sure the backend server is running on `http://localhost:8000` before starting the frontend development server.

The frontend will proxy API requests to the backend during development. 