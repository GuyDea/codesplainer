import { createContext } from 'react';

/** Actions available to conversation map cards. */
export const MapContext = createContext<{ open: (graphId: string) => void }>({ open: () => {} });
