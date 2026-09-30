export { GraphCanvas } from './GraphCanvas';
export { ConversationMap } from './ConversationMap';
export { GraphThumbnail } from './GraphThumbnail';
export { Legend } from './Legend';
export * from './types';
export * from './visuals';
// Added helpers (pure, framework free).
export { thumbnailBoxes } from './thumbnail';
export { layoutGraph, peekGraphLayout, type GraphLayout, type Rect as LayoutRect } from './layout';
export { refChipText, refTitle } from './refs';
export { preferredChild } from './canvas/children';
export { diagramSteps, stepCaption, stepCode, type DiagramStep } from './steps';
