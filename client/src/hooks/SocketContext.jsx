import { createContext, useContext } from 'react';
import { useSocket } from './useSocket';

const SocketContext = createContext(null);

/**
 * Establishes the single Socket.io connection for the whole app (mount this
 * once, at the top level — see App.jsx) and makes its state available to
 * any component via useSocketContext(), instead of each page opening its
 * own redundant connection.
 */
export function SocketProvider({ children, feedLimit }) {
  const socket = useSocket({ feedLimit });
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocketContext() {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error('useSocketContext() must be used inside <SocketProvider>');
  }
  return ctx;
}
