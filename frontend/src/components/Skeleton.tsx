import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View, ViewStyle } from "react-native";

import { useTheme } from "@/src/theme/ThemeProvider";
import { radius } from "@/src/theme/tokens";

type Props = {
  width?: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
  round?: number;
};

export function Skeleton({ width = "100%", height = 14, style, round = radius.sm }: Props) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: round, backgroundColor: colors.surfaceTertiary, opacity: pulse },
        style,
      ]}
    />
  );
}

export function SkeletonRow({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.rows}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={64} height={88} round={radius.md} />
          <View style={styles.rowText}>
            <Skeleton width="70%" height={16} />
            <Skeleton width="40%" height={12} />
            <Skeleton width="55%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 16 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  rowText: { flex: 1, gap: 8 },
});
