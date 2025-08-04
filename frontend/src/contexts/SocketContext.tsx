import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext.tsx';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinUserRoom: (userId: string) => void;
  joinSession: (sessionId: string) => void;
  sendMessage: (sessionId: string, message: string) => void;
  setTyping: (sessionId: string, isTyping: boolean) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = (): SocketContextType => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      // Initialize socket connection
      const socketUrl = (process.env.REACT_APP_SOCKET_URL as string) || 'http://localhost:8000';
      const newSocket = io(socketUrl, {
        auth: {
          token: localStorage.getItem('authToken'),
        },
        // Prevent automatic reconnection to avoid rate limiting
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
      });

      newSocket.on('connect', () => {
        console.log('Connected to server');
        setIsConnected(true);
        // Join user's personal room for notifications
        newSocket.emit('join-user-room', user.id);
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from server');
        setIsConnected(false);
      });

      newSocket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        setIsConnected(false);
      });

      setSocket(newSocket);

      return () => {
        console.log('Cleaning up socket connection');
        newSocket.close();
      };
    } else if (socket) {
      // User logged out, disconnect socket
      console.log('User logged out, disconnecting socket');
      socket.close();
      setSocket(null);
      setIsConnected(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]); // socket intentionally omitted to prevent infinite loop

  const joinUserRoom = (userId: string): void => {
    if (socket && isConnected) {
      socket.emit('join-user-room', userId);
    }
  };

  const joinSession = (sessionId: string): void => {
    if (socket && isConnected) {
      socket.emit('join-session', sessionId);
    }
  };

  const sendMessage = (sessionId: string, message: string): void => {
    if (socket && isConnected) {
      socket.emit('simulation-message', {
        sessionId,
        message,
      });
    }
  };

  const setTyping = (sessionId: string, isTyping: boolean): void => {
    if (socket && isConnected) {
      socket.emit('typing', {
        sessionId,
        isTyping,
      });
    }
  };

  const value: SocketContextType = {
    socket,
    isConnected,
    joinUserRoom,
    joinSession,
    sendMessage,
    setTyping,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}; 