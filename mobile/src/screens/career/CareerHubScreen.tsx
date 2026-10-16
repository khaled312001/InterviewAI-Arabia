import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';

import { useAppTheme } from '../../theme/useTheme';
import { Screen, Text, Card, ListRow, Badge, SkeletonCard } from '../../components';
import { careerApi, percentTone, type Overview } from './careerApi';

/** The career section's front door: CV, tailored versions, tracker, alerts. */
export function CareerHubScreen({ navigation }: any) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [ov, setOv] = useState<Overview | null>(null);

  useFocusEffect(useCallback(() => {
    careerApi.overview().then(setOv).catch(() => setOv((prev) => prev));
  }, []));

  const appsTotal = ov ? Object.values(ov.applications).reduce((n, x) => n + (x || 0), 0) : 0;

  return (
    <Screen scroll contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      <View>
        <Text role="h3" weight="bold">{t('career.hub.title')}</Text>
        <Text role="bodySm" tone="secondary">{t('career.hub.subtitle')}</Text>
      </View>
      {!ov ? <SkeletonCard height={220} /> : (
        <Card padding="none">
          <ListRow
            icon="document-text-outline"
            iconTone="primary"
            title={t('career.hub.cv')}
            subtitle={ov.hasProfile && ov.cvScore != null ? t('career.hub.cvScore', { score: ov.cvScore }) : t('career.hub.cvMissing')}
            trailing={ov.cvScore != null ? <Badge tone={percentTone(ov.cvScore)} label={String(ov.cvScore)} /> : undefined}
            onPress={() => navigation.navigate('CvBuilder')}
            divider
          />
          <ListRow
            icon="sparkles-outline"
            iconTone="accent"
            title={t('career.hub.versions')}
            trailing={ov.versions ? <Badge label={String(ov.versions)} /> : undefined}
            onPress={() => navigation.navigate('CvVersions')}
            divider
          />
          <ListRow
            icon="albums-outline"
            iconTone="success"
            title={t('career.hub.applications')}
            trailing={appsTotal ? <Badge label={String(appsTotal)} /> : undefined}
            onPress={() => navigation.navigate('Applications')}
            divider
          />
          <ListRow
            icon="notifications-outline"
            iconTone="warning"
            title={t('career.hub.alerts')}
            trailing={ov.savedSearches ? <Badge label={String(ov.savedSearches)} /> : undefined}
            onPress={() => navigation.navigate('SavedSearches')}
          />
        </Card>
      )}
      <Card padding="none">
        <ListRow
          icon="create-outline"
          title={t('career.tailorScreen.title')}
          subtitle={t('career.tailorScreen.pasteJd')}
          onPress={() => navigation.navigate('Tailor')}
        />
      </Card>
    </Screen>
  );
}
