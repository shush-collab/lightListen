import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme/ThemeProvider";
import { fonts, fontSize, radius, spacing } from "@/src/theme/tokens";

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  testID?: string;
  children: React.ReactNode;
  scroll?: boolean;
};

export function Sheet({ visible, onClose, title, testID, children, scroll = false }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const body = (
    <View style={styles.body}>{children}</View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        testID={testID ? `${testID}-backdrop` : "sheet-backdrop"}
        style={styles.backdrop}
        onPress={onClose}
      />
      <View
        testID={testID}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.border,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.onSurface }]}>{title}</Text>
          <Pressable
            testID={testID ? `${testID}-close` : "sheet-close"}
            onPress={onClose}
            hitSlop={12}
            style={[styles.close, { backgroundColor: colors.surfaceTertiary }]}
          >
            <Feather name="x" size={18} color={colors.onSurface} />
          </Pressable>
        </View>
        {scroll ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        ) : (
          body
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "78%",
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: fontSize.xl },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flexGrow: 0 },
  body: { gap: spacing.sm, paddingBottom: spacing.sm },
});
