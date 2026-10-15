import { ViewTransition } from 'react';

// Templates remount on every navigation, so the outgoing page plays its exit and the incoming one its enter.
// Links in the nav tag navigations as forward or back so pages slide in the matching direction; anything else fades.
export default function Template({ children }) {
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'page-fade' }}
      exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'page-fade' }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
