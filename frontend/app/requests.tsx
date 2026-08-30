import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import type { CommunityRequest } from "@/src/api/types";
import { track } from "@/src/analytics";
import { SegmentedControl } from "@/src/components/Chips";
import { StatusBadge } from "@/src/components/StatusBadge";
import { EmptyState } from "@/src/components/States";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { enablePush, hasBeenPrompted } from "@/src/push";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Tab = "all" | "mine";

export default function RequestsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const bottomPadding = useBottomPadding(false);

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [altTitle, setAltTitle] = useState("");
  const [items, setItems] = useState<CommunityRequest[]>([]);
  const [mine, setMine] = useState<CommunityRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [all, own] = await Promise.all([
        api.requests(query.trim() || undefined),
        api.myRequests().catch(() => []),
      ]);
      setItems(all);
      setMine(own);
    } catch {
      toast("Could not load requests", "error");
    } finally {
      setLoading(false);
    }
  }, [query, toast]);

  useEffect(() => {
    const id = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, query]);

  const exactMatch = useMemo(
    () => items.some((item) => item.title.trim().toLowerCase() === query.trim().toLowerCase()),
    [items, query],
  );

  const vote = async (request: CommunityRequest) => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const updated = await api.vote(request.id);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setMine((prev) => {
        const exists = prev.some((i) => i.id === updated.id);
        return exists ? prev.map((i) => (i.id === updated.id ? updated : i)) : [updated, ...prev];
      });
      toast(request.has_voted ? "You already voted for this" : "Vote counted", "success");
      track("request_voted", { properties: { request_id: request.id, title: request.title } });
      void maybeOfferNotifications();
    } catch {
      toast("Could not register your vote", "error");
    }
  };

  /**
   * Notification permission is asked here rather than on first launch — voting is the
   * moment a "your novel is ready" push actually becomes useful.
   */
  const maybeOfferNotifications = useCallback(async () => {
    if (!user) return;
    if (await hasBeenPrompted()) return;
    const outcome = await enablePush();
    if (outcome === "granted") {
      toast("We'll notify you the moment it is published", "success");
    }
  }, [user, toast]);

  const createRequest = async () => {
    const title = query.trim();
    if (title.length < 2) {
      toast("Type the novel title first", "error");
      return;
    }
    setBusy(true);
    try {
      const created = await api.createRequest(title, altTitle.trim() || undefined);
      setAltTitle("");
      setQuery("");
      toast(`“${created.title}” submitted`, "success");
      track("request_submitted", { properties: { request_id: created.id, title: created.title } });
      void maybeOfferNotifications();
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not submit request", "error");
    } finally {
      setBusy(false);
    }
  };

  const list = tab === "all" ? items : mine;

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderColor: colors.divider }]}>
        <View style={styles.headerTop}>
          <Pressable
            testID="requests-back"
            onPress={() => router.back()}
            hitSlop={10}
            style={[styles.circle, { backgroundColor: colors.surfaceSecondary }]}
          >
            <Feather name="chevron-left" size={20} color={colors.onSurface} />
          </Pressable>
          <Text style={[styles.title, { color: colors.onSurface }]}>Community</Text>
          <View style={styles.circle} />
        </View>

        <View
          style={[
            styles.searchWrap,
            { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={17} color={colors.onSurfaceSecondary} />
          <TextInput
            testID="requests-search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Type a novel title to request or vote"
            placeholderTextColor={colors.onSurfaceSecondary}
            style={[styles.search, { color: colors.onSurface }]}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable testID="requests-clear" hitSlop={10} onPress={() => setQuery("")}>
              <Feather name="x-circle" size={17} color={colors.onSurfaceSecondary} />
            </Pressable>
          ) : null}
        </View>

        <SegmentedControl<Tab>
          testIDPrefix="requests-tab"
          value={tab}
          onChange={setTab}
          options={[
            { key: "all", label: "Top requests" },
            { key: "mine", label: "My activity" },
          ]}
        />
      </View>

      <ScrollView
        testID="requests-scroll"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.body, { paddingBottom: bottomPadding }]}
      >
        {tab === "all" && query.trim().length >= 2 && !exactMatch ? (
          <View
            style={[
              styles.createCard,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.brand },
            ]}
          >
            <Text style={[styles.createTitle, { color: colors.onSurface }]}>
              No request for “{query.trim()}” yet
            </Text>
            <TextInput
              testID="requests-alt-input"
              value={altTitle}
              onChangeText={setAltTitle}
              placeholder="Alternative title (optional)"
              placeholderTextColor={colors.onSurfaceSecondary}
              style={[
                styles.altInput,
                { backgroundColor: colors.surface, color: colors.onSurface, borderColor: colors.border },
              ]}
            />
            <Pressable
              testID="requests-create-button"
              onPress={createRequest}
              disabled={busy}
              style={[styles.createBtn, { backgroundColor: colors.brand, opacity: busy ? 0.7 : 1 }]}
            >
              {busy ? (
                <ActivityIndicator color={colors.onBrand} size="small" />
              ) : (
                <>
                  <Feather name="plus" size={16} color={colors.onBrand} />
                  <Text style={[styles.createBtnText, { color: colors.onBrand }]}>
                    Submit this request
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : list.length === 0 ? (
          <EmptyState
            testID="requests-empty"
            icon="trending-up"
            title={tab === "mine" ? "No activity yet" : "No requests yet"}
            message={
              tab === "mine"
                ? "Requests you submit or vote on will be tracked here."
                : "Type a title above to start the very first request."
            }
          />
        ) : (
          list.map((item) => (
            <View
              key={item.id}
              testID={`request-row-${item.id}`}
              style={[
                styles.row,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              ]}
            >
              <Pressable
                testID={`request-vote-${item.id}`}
                onPress={() => vote(item)}
                style={[
                  styles.voteBox,
                  {
                    backgroundColor: item.has_voted ? colors.brand : colors.surfaceTertiary,
                    borderColor: item.has_voted ? colors.brand : colors.border,
                  },
                ]}
              >
                <Feather
                  name="chevron-up"
                  size={16}
                  color={item.has_voted ? colors.onBrand : colors.onSurface}
                />
                <Text
                  style={[
                    styles.voteCount,
                    { color: item.has_voted ? colors.onBrand : colors.onSurface },
                  ]}
                >
                  {item.vote_count}
                </Text>
              </Pressable>
              <View style={styles.rowBody}>
                <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.onSurface }]}>
                  {item.title}
                </Text>
                {item.alt_title ? (
                  <Text numberOfLines={1} style={[styles.rowAlt, { color: colors.onSurfaceSecondary }]}>
                    {item.alt_title}
                  </Text>
                ) : null}
                <View style={styles.rowMeta}>
                  <StatusBadge status={item.status} testID={`request-status-${item.id}`} />
                  {item.is_mine ? (
                    <Text style={[styles.tag, { color: colors.brand }]}>Yours</Text>
                  ) : null}
                </View>
              </View>
              {item.linked_novel_id ? (
                <Pressable
                  testID={`request-open-novel-${item.id}`}
                  onPress={() => router.push(`/novel/${item.linked_novel_id}`)}
                  hitSlop={8}
                  style={styles.open}
                >
                  <Feather name="arrow-up-right" size={18} color={colors.success} />
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: fontSize.xl },
  circle: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  search: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.lg, height: 48 },
  body: { padding: spacing.lg, gap: spacing.sm },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  createCard: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  createTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg },
  altInput: {
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
    fontSize: fontSize.base,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radius.pill,
  },
  createBtnText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  voteBox: {
    width: 48,
    minHeight: 52,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  voteCount: { fontFamily: fonts.bold, fontSize: fontSize.base },
  rowBody: { flex: 1, gap: spacing.xs },
  rowTitle: { fontFamily: fonts.semibold, fontSize: fontSize.lg, lineHeight: 21 },
  rowAlt: { fontFamily: fonts.regular, fontSize: fontSize.sm },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tag: { fontFamily: fonts.semibold, fontSize: fontSize.sm - 1 },
  open: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
