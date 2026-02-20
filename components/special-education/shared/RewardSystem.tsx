import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSpecialEducationProgress } from './SpecialEducationProgress';

interface RewardSystemProps {
  section: number;
}

export function RewardSystem({ section }: RewardSystemProps) {
  const { progress } = useSpecialEducationProgress();
  const sectionData = progress?.sections.find((s) => s.sectionNumber === section);
  const isCompleted = sectionData?.completed || false;

  if (!isCompleted) {
    return null;
  }

  return (
    <View style={styles.rewardContainer}>
      <View style={styles.rewardIcon}>
        <Ionicons name="trophy" size={32} color="#F59E0B" />
      </View>
      <Text style={styles.rewardTitle}>Section {section} Complete!</Text>
      <Text style={styles.rewardDescription}>
        You've unlocked a new section key! 🗝️
      </Text>
    </View>
  );
}

export function SectionRewardBadge({ section }: { section: number }) {
  const { progress } = useSpecialEducationProgress();
  const sectionData = progress?.sections.find((s) => s.sectionNumber === section);
  const isCompleted = sectionData?.completed || false;

  if (!isCompleted) {
    return null;
  }

  return (
    <View style={styles.badge}>
      <Ionicons name="trophy" size={16} color="#F59E0B" />
      <Text style={styles.badgeText}>Complete</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rewardContainer: {
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    margin: 16,
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  rewardIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  rewardTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  rewardDescription: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F59E0B',
  },
});


