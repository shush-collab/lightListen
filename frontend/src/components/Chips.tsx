import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

export const CHIP_ROW_HEIGHT = 56;

type Props = {
  options: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  testIDPrefix: string;
  allLabel?: string;
};

/** Single-line horizontal chip scroller (chrome, never wraps). */
export function ChipRow({ options, selected, onSelect, testIDPrefix, allLabel = "All" }: Props) {
  const { colors } = useTheme();

  const renderChip = (label: string, value: string | null, key: string) => {
    const active = selected === value;
    return (
      <Pressable
        key={key}
        testID={`${testIDPrefix}-${value ?? "all"}`}
        onPress={() => onSelect(value)}
        style={[
          styles.chip,
          {
            backgroundColor: active ? colors.brand : colors.surfaceSecondary,
            borderColor: active ? colors.brand : colors.border,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.chipText, { color: active ? colors.onBrand : colors.onSurfaceSecondary }]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {renderChip(allLabel, null, "all")}
        {options.map((opt) => renderChip(opt, opt, opt))}
      </ScrollView>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { key: T; label: string; icon?: string }[];
  value: T;
  onChange: (key: T) => void;
  testIDPrefix: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            testID={`${testIDPrefix}-${opt.key}`}
            onPress={() => onChange(opt.key)}
            style={[
              styles.segmentItem,
              { backgroundColor: active ? colors.brand : "transparent" },
            ]}
          >
            {opt.icon ? (
              <Feather
                name={opt.icon as never}
                size={14}
                color={active ? colors.onBrand : colors.onSurfaceSecondary}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={[styles.segmentText, { color: active ? colors.onBrand : colors.onSurfaceSecondary }]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: CHIP_ROW_HEIGHT, justifyContent: "center" },
  content: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.medium, fontSize: fontSize.base },
  segment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    height: 40,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
  },
  segmentText: { fontFamily: fonts.semibold, fontSize: fontSize.base },
});
