import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import type { Novel } from "@/src/api/types";
import { ChipRow } from "@/src/components/Chips";
import { GridCard } from "@/src/components/NovelCard";
import { EmptyState, ErrorState } from "@/src/components/States";
import { useBottomPadding } from "@/src/hooks/use-bottom-padding";
import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export default function ExploreScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const bottomPadding = useBottomPadding(true);

  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cardWidth = useMemo(() => {
    const columns = width > 700 ? 3 : 2;
    return (Math.min(width, 900) - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;
  }, [width]);
  const numColumns = width > 700 ? 3 : 2;

  useEffect(() => {
    api
      .genres()
      .then(setGenres)
      .catch(() => setGenres([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.novels({
        q: query.trim() || undefined,
        genre: genre ?? undefined,
        sort: "title",
        limit: 100,
      });
      setNovels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the catalog");
    } finally {
      setLoading(false);
    }
  }, [query, genre]);

  useEffect(() => {
    const id = setTimeout(() => void load(), query ? 320 : 0);
    return () => clearTimeout(id);
  }, [load, query]);

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, borderColor: colors.divider }]}>
        <Text style={[styles.title, { color: colors.onSurface }]}>Explore</Text>
        <View
          style={[
            styles.searchWrap,
            { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={17} color={colors.onSurfaceSecondary} />
          <TextInput
            testID="explore-search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Title, alt title or author"
            placeholderTextColor={colors.onSurfaceSecondary}
            style={[styles.search, { color: colors.onSurface }]}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable testID="explore-search-clear" hitSlop={10} onPress={() => setQuery("")}>
              <Feather name="x-circle" size={17} color={colors.onSurfaceSecondary} />
            </Pressable>
          ) : null}
        </View>
        <ChipRow
          options={genres}
          selected={genre}
          onSelect={setGenre}
          testIDPrefix="explore-genre"
          allLabel="All genres"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <ErrorState testID="explore-error" message={error} onRetry={load} />
      ) : (
        <FlatList
          testID="explore-grid"
          data={novels}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          key={`cols-${numColumns}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          columnWrapperStyle={styles.column}
          contentContainerStyle={[styles.grid, { paddingBottom: bottomPadding }]}
          renderItem={({ item }) => (
            <GridCard testID={`explore-card-${item.id}`} novel={item} width={cardWidth} />
          )}
          ListEmptyComponent={
            <EmptyState
              testID="explore-empty"
              icon="search"
              title={query ? "No matches" : "Nothing published yet"}
              message={
                query
                  ? `Nothing found for “${query}”. Try a different keyword — or request it from the community tab.`
                  : "New novels will appear here as soon as they are published."
              }
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 0,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: fontSize.xxl,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  searchWrap: {
    marginHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  search: { flex: 1, fontFamily: fonts.regular, fontSize: fontSize.lg, height: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  grid: { padding: spacing.lg, gap: spacing.lg },
  column: { gap: spacing.md },
});
