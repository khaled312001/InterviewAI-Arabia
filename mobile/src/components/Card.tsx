import { View, StyleSheet, ViewProps } from 'react-native';
import { useAppTheme } from '../theme/useTheme';

export function Card({ style, children, ...rest }: ViewProps) {
  const theme = useAppTheme();
  return (
    <View
      {...rest}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          shadowColor: '#000',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
});
