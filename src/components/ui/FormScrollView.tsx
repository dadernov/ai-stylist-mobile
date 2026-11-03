import { forwardRef } from 'react';
import { FlatList, FlatListProps, Keyboard, Platform, ScrollView, ScrollViewProps } from 'react-native';
import { useSheetScroller } from '../studio/SheetHandle';

export const FormScrollView = forwardRef<ScrollView, ScrollViewProps>(function FormScrollView({ onScrollBeginDrag, ...rest }, ref) {
  const props = useSheetScroller(rest, Boolean(rest.horizontal));
  return <ScrollView ref={ref} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
    keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
    showsVerticalScrollIndicator={false} {...props} onScrollBeginDrag={event => { Keyboard.dismiss(); onScrollBeginDrag?.(event); }} />;
});

/** A FlatList that hands the pull at its top to the sheet it is in. */
export function SheetFlatList<T>(props: FlatListProps<T>) {
  return <FlatList {...useSheetScroller(props, Boolean(props.horizontal))} />;
}
