import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import type { CommunityRequest, ContinueItem, Novel } from "@/src/api/types";
import { NovelListRow, PosterCard } from "@/src/components/NovelCard";
import { Skeleton, SkeletonRow } from "@/src/components/Skeleton";
import { EmptyState, ErrorState } from "@/src/components/States";
import { useAuth } from "@/src/context/AuthContext";
import { usePlayer } from "@/src/context/PlayerContext";
import { useToast } from "@/src/context/ToastContext";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, formatDuration, radius, spacing } from "@/src/theme/tokens";

export default function HomeScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { playChapter } = usePlayer();
  const bottomPadding = useBottomPadding(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  const [fresh, setFresh] = useState<Novel[]>([]);
  const [popular, setPopular] = useState<Novel[]>([]);
  const [requests, setRequests] = useState<CommunityRequest[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cont, newest, pop, reqs] = await Promise.all([
        api.continueListening().catch(() => []),
        api.novels({ sort: "new", limit: 12 }),
        api.novels({ sort: "popular", limit: 8 }),
        api.requests().catch(() => []),
      ]);
      setContinueItems(cont);
      setFresh(newest);
      setPopular(pop);
      setRequests(reqs.slice(0, 3));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const resume = async (item: ContinueItem) => {
    if (!item.chapter) {
      router.push(`/novel/${item.novel.id}`);
      return;
    }
    try {
      const chapters = await api.chapters(item.novel.id);
      const index = chapters.findIndex((c) => c.id === item.chapter?.id);
      playChapter(item.novel, chapters, index < 0 ? 0 : index, item.position_seconds);
      router.push("/player");
    } catch {
      toast("Could not start playback", "error");
    }
  };

  const initials = (user?.display_name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderColor: colors.divider }]}>
        <View>
          <Text style={[styles.wordmark, { color: colors.onSurface }]}>LightListen</Text>
          <Text style={[styles.greeting, { color: colors.onSurfaceSecondary }]}>
            {user?.display_name ? `Welcome back, ${user.display_name}` : "Light novels, narrated"}
          </Text>
        </View>
        <Pressable
          testID="home-profile-button"
          onPress={() => router.push("/profile")}
          style={[styles.avatar, { backgroundColor: colors.brandTertiary, borderColor: colors.brand }]}
        >
          <Text style={[styles.avatarText, { color: colors.onBrandTertiary }]}>{initials}</Text>
        </Pressable>
      </View>

      <ScrollView
        testID="home-scroll"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
        }
      >
        {loading ? (
          <View style={styles.loading}>
            <Skeleton width="55%" height={22} />
            <View style={styles.rowGap}>
              <Skeleton width={148} height={210} round={radius.md} />
              <Skeleton width={148} height={210} round={radius.md} />
            </View>
            <SkeletonRow count={3} />
          </View>
        ) : error ? (
          <ErrorState testID="home-error" message={error} onRetry={load} />
        ) : (
          <>
            {continueItems.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Continue listening" />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.hList}
                >
                  {continueItems.map((item) => (
                    <View key={item.novel.id} style={styles.continueCard}>
                      <PosterCard
                        testID={`continue-card-${item.novel.id}`}
                        novel={item.novel}
                        subtitle={item.chapter ? `Ch. ${item.chapter.chapter_number}` : item.novel.author}
                        progress={
                          item.chapter && item.chapter.duration_seconds > 0
                            ? item.position_seconds / item.chapter.duration_seconds
                            : 0
                        }
                      />
                      <Pressable
                        testID={`continue-resume-${item.novel.id}`}
                        onPress={() => resume(item)}
                        style={[styles.resumeBtn, { backgroundColor: colors.brand }]}
                      >
                        <Feather name="play" size={13} color={colors.onBrand} />
                        <Text style={[styles.resumeText, { color: colors.onBrand }]}>
                          {formatDuration(item.position_seconds)}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="New this week" />
              {fresh.length === 0 ? (
                <EmptyState
                  testID="home-empty-catalog"
                  icon="book-open"
                  title="The shelf is still empty"
                  message="Published novels will show up here as soon as they are added."
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.hList}
                >
                  {fresh.map((novel) => (
                    <PosterCard key={novel.id} testID={`new-card-${novel.id}`} novel={novel} />
                  ))}
                </ScrollView>
              )}
            </View>

            {popular.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Popular now" />
                <View style={styles.vList}>
                  {popular.map((novel) => (
                    <NovelListRow key={novel.id} testID={`popular-row-${novel.id}`} novel={novel} />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Community requests" />
              <Pressable
                testID="home-requests-banner"
                onPress={() => router.push("/requests")}
                style={[
                  styles.banner,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.brand },
                ]}
              >
                <View style={styles.bannerTop}>
                  <Feather name="trending-up" size={18} color={colors.brand} />
                  <Text style={[styles.bannerTitle, { color: colors.onSurface }]}>
                    Vote on what gets narrated next
                  </Text>
                </View>
                {requests.length === 0 ? (
                  <Text style={[styles.bannerBody, { color: colors.onSurfaceSecondary }]}>
                    No requests yet — be the first to ask for a novel.
                  </Text>
                ) : (
                  requests.map((req) => (
                    <View key={req.id} style={styles.bannerRow}>
                      <Text
                        numberOfLines={1}
                        style={[styles.bannerRowTitle, { color: colors.onSurfaceSecondary }]}
                      >
                        {req.title}
                      </Text>
                      <View style={[styles.votePill, { backgroundColor: colors.brandTertiary }]}>
                        <Feather name="chevron-up" size={12} color={colors.onBrandTertiary} />
                        <Text style={[styles.voteText, { color: colors.onBrandTertiary }]}>
                          {req.vote_count}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
                <View style={styles.bannerCta}>
                  <Text style={[styles.bannerCtaText, { color: colors.brand }]}>
                    Request a novel
                  </Text>
                  <Feather name="arrow-right" size={14} color={colors.brand} />
                </View>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{title}</Text>
      <View style={[styles.rule, { backgroundColor: colors.brand }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  wordmark: { fontFamily: fonts.display, fontSize: fontSize.xxl, letterSpacing: 0.3 },
  greeting: { fontFamily: fonts.regular, fontSize: fontSize.sm, marginTop: 2 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.bold, fontSize: fontSize.lg },
  loading: { padding: spacing.lg, gap: spacing.lg },
  rowGap: { flexDirection: "row", gap: spacing.md },
  section: { marginTop: spacing.xl, gap: spacing.md },
  sectionHeader: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.display, fontSize: fontSize.xl },
  rule: { width: 36, height: 2, borderRadius: radius.pill },
  hList: { paddingHorizontal: spacing.lg, gap: spacing.md },
  vList: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  continueCard: { gap: spacing.sm },
  resumeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    height: 34,
    borderRadius: radius.pill,
  },
  resumeText: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
  banner: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    gap: spacing.sm,
  },
  bannerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bannerTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: fontSize.lg },
  bannerBody: { fontFamily: fonts.regular, fontSize: fontSize.base },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bannerRowTitle: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.base },
  votePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  voteText: { fontFamily: fonts.semibold, fontSize: fontSize.sm },
  bannerCta: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  bannerCtaText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
});
