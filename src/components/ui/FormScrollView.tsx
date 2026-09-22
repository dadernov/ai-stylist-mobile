import { forwardRef } from 'react';
import { Keyboard, Platform, ScrollView, ScrollViewProps } from 'react-native';

export const FormScrollView = forwardRef<ScrollView, ScrollViewProps>(function FormScrollView({ onScrollBeginDrag, ...props }, ref) {
  return <ScrollView ref={ref} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
    keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
    showsVerticalScrollIndicator={false} {...props} onScrollBeginDrag={event => { Keyboard.dismiss(); onScrollBeginDrag?.(event); }} />;
});
