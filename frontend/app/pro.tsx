import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import type { ProFeature } from "@/src/api/types";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

const FALLBACK: ProFeature[] = [
  { title: "Anytime requests", description: "Skip the vote queue — request any novel, any time." },
  {
    title: "Private EPUB audiobooks",
    description: "Upload your own EPUB and get a private narrated audiobook.",
  },
];

export default function ProScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bottomPadding = useBottomPadding(false);
  const [features, setFeatures] = useState<ProFeature[]>(FALLBACK);

  useEffect(() => {
    api
      .pro()
      .then((res) => setFeatures(res.features?.length ? res.features : FALLBACK))
      .catch(() => setFeatures(FALLBACK));
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderColor: colors.divider }]}>
        <Pressable
          testID="pro-back"
          onPress={() => router.back()}
          hitSlop={10}
          style={[styles.circle, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Feather name="chevron-left" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.title, { color: colors.onSurface }]}>LightListen Pro</Text>
        <View style={styles.circle} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottomPadding }]}>
        <View style={[styles.hero, { backgroundColor: colors.surfaceTertiary, borderColor: colors.brand }]}>
          <View style={[styles.soon, { backgroundColor: colors.brand }]}>
            <Text style={[styles.soonText, { color: colors.onBrand }]}>Coming soon</Text>
          </View>
          <Text style={[styles.heroTitle, { color: colors.onSurface }]}>
            Your shelf, on your terms
          </Text>
          <Text style={[styles.heroBody, { color: colors.onSurfaceSecondary }]}>
            Pro is not for sale yet. Everything in LightListen is free while we build the catalog —
            here is what Pro will unlock when it launches.
          </Text>
        </View>

        {features.map((feature) => (
          <View
            key={feature.title}
            testID={`pro-feature-${feature.title.toLowerCase().replace(/\s+/g, "-")}`}
            style={[styles.feature, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <View style={[styles.featureIcon, { backgroundColor: colors.brandTertiary }]}>
              <Feather name="star" size={16} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.featureText}>
              <Text style={[styles.featureTitle, { color: colors.onSurface }]}>{feature.title}</Text>
              <Text style={[styles.featureBody, { color: colors.onSurfaceSecondary }]}>
                {feature.description}
              </Text>
            </View>
          </View>
        ))}

        <View style={[styles.notice, { borderColor: colors.border }]}>
          <Feather name="info" size={14} color={colors.onSurfaceSecondary} />
          <Text style={[styles.noticeText, { color: colors.onSurfaceSecondary }]}>
            No payment is collected today. Keep voting on community requests to shape the catalog.
          </Text>
        </View>

        <Pressable
          testID="pro-requests-cta"
          onPress={() => router.push("/requests")}
          style={[styles.cta, { backgroundColor: colors.brand }]}
        >
          <Feather name="trending-up" size={16} color={colors.onBrand} />
          <Text style={[styles.ctaText, { color: colors.onBrand }]}>Vote on requests instead</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.display, fontSize: fontSize.xl },
  circle: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, gap: spacing.md },
  hero: { padding: spacing.lg, borderRadius: radius.md, borderLeftWidth: 3, gap: spacing.sm },
  soon: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  soonText: { fontFamily: fonts.semibold, fontSize: fontSize.sm - 2 },
  heroTitle: { fontFamily: fonts.display, fontSize: fontSize.xxl, lineHeight: 30 },
  heroBody: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 21 },
  feature: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, gap: 3 },
  featureTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg - 1 },
  featureBody: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 20 },
  notice: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  noticeText: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.sm, lineHeight: 18 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 50,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  ctaText: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
});
