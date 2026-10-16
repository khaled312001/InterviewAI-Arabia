import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme, useDirection } from '../../theme/useTheme';
import { Card, Text, Badge } from '../../components';

/**
 * The way into the Live Interview Assistant from Home — directly under the
 * practice-interview card, because it is the same promise on the real day.
 */
export const AssistEntryCard = React.memo(function AssistEntryCard({ onPress }: { onPress: () => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { chevronForward } = useDirection();

  return (
    <Card
      onPress={onPress}
      padding="lg"
      accessibilityLabel={t('assist.entryTitle')}
      accessibilityHint={t('assist.entrySubtitle')}
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <View
          style={[styles.icon, {
            width: theme.layout.avatar.md,
            height: theme.layout.avatar.md,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.primaryMuted,
          }]}
        >
          <Ionicons name="ear" size={theme.layout.icon.lg} color={theme.colors.primary} />
        </View>
        <View style={styles.grow}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text role="bodyLg" weight="bold" numberOfLines={1} flex>{t('assist.entryTitle')}</Text>
            <Badge tone="success" icon="radio" label={t('assist.entryBadge')} />
          </View>
          <Text role="caption" tone="secondary" numberOfLines={2}>{t('assist.entrySubtitle')}</Text>
        </View>
        <Ionicons
          name={chevronForward}
          size={theme.layout.icon.md}
          color={theme.colors.textMuted}
        />
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  icon: { alignItems: 'center', justifyContent: 'center' },
});
