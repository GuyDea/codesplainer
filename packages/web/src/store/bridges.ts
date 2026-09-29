/**
 * Imperative handles of the mounted canvas / map, shared with actions that are triggered from
 * outside the conversation screen (command palette, shortcuts, exports).
 */
import { createRef } from 'react';
import type { ConversationMapHandle, GraphCanvasHandle } from '../graph/types';

export const graphCanvasRef = createRef<GraphCanvasHandle>();
export const conversationMapRef = createRef<ConversationMapHandle>();
