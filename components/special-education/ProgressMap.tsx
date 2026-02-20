import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSpecialEducationProgress } from './shared/SpecialEducationProgress';
import { SectionRewardBadge } from './shared/RewardSystem';

const SECTION_THEMES: { [key: number]: { title: string; theme: string; emoji: string; color: string } } = {
  1: { title: 'The Explorer', theme: 'Forest', emoji: '🌲', color: '#10B981' },
  2: { title: 'The Matcher', theme: 'Ocean', emoji: '🌊', color: '#0EA5E9' },
  3: { title: 'The Builder', theme: 'Mountain', emoji: '⛰️', color: '#8B5CF6' },
  4: { title: 'The Grouper', theme: 'Desert', emoji: '🏜️', color: '#F59E0B' },
  5: { title: 'The Counter', theme: 'Sky', emoji: '☁️', color: '#3B82F6' },
  6: { title: 'The Logic Lab', theme: 'City', emoji: '🏙️', color: '#6366F1' },
  7: { title: 'The Reader', theme: 'Space', emoji: '🚀', color: '#8B5CF6' },
  8: { title: 'The Citizen', theme: 'Planet', emoji: '🪐', color: '#EC4899' },
  9: { title: 'The Clockwise', theme: 'Galaxy', emoji: '🌌', color: '#6366F1' },
  10: { title: 'The Graduate', theme: 'Space Station', emoji: '🛸', color: '#8B5CF6' },
};

interface ProgressMapProps {
  onBack: () => void;
  currentSection: number;
}

export function ProgressMap({ onBack, currentSection }: ProgressMapProps) {
  const { progress } = useSpecialEducationProgress();
  const sections = Array.from({ length: 10 }, (_, i) => i + 1);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Progress Map</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mapContainer}>
          <Text style={styles.mapTitle}>Your Learning Journey</Text>
          <Text style={styles.mapDescription}>
            Complete sections to unlock new worlds and collect rewards!
          </Text>

          <View style={styles.sectionsList}>
            {sections.map((sectionNum) => {
              const section = SECTION_THEMES[sectionNum];
              const sectionData = progress?.sections.find((s) => s.sectionNumber === sectionNum);
              const isUnlocked = sectionData?.unlocked || sectionNum === 1;
              const isCompleted = sectionData?.completed || false;
              const isCurrent = sectionNum === (progress?.currentSection || currentSection);

              return (
                <View
                  key={sectionNum}
                  style={[
                    styles.sectionMapCard,
                    isUnlocked && { borderColor: section.color },
                    isCurrent && { borderWidth: 3, backgroundColor: `${section.color}10` },
                  ]}
                >
                  <View style={[styles.sectionMapIcon, { backgroundColor: `${section.color}20` }]}>
                    <Text style={styles.sectionMapEmoji}>{section.emoji}</Text>
                    {isCompleted && (
                      <View style={styles.completedBadge}>
                        <Ionicons name="checkmark-circle" size={20} color={section.color} />
                      </View>
                    )}
                  </View>
                  <View style={styles.sectionMapInfo}>
                    <Text style={styles.sectionMapNumber}>Section {sectionNum}</Text>
                    <Text style={styles.sectionMapTitle}>{section.title}</Text>
                    <Text style={styles.sectionMapTheme}>{section.theme}</Text>
                  </View>
                  <View style={styles.sectionMapBadges}>
                    {isCompleted && <SectionRewardBadge section={sectionNum} />}
                    {isCurrent && !isCompleted && (
                      <View style={[styles.currentBadge, { backgroundColor: section.color }]}>
                        <Text style={styles.currentBadgeText}>Current</Text>
                      </View>
                    )}
                    {!isUnlocked && (
                      <View style={styles.lockBadge}>
                        <Ionicons name="lock-closed" size={16} color="#9CA3AF" />
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
              <Text style={styles.legendText}>Completed</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#3B82F6' }]} />
              <Text style={styles.legendText}>Current</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#9CA3AF' }]} />
              <Text style={styles.legendText}>Locked</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  mapContainer: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  mapTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  mapDescription: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  sectionsList: {
    gap: 12,
    marginBottom: 24,
  },
  sectionMapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    gap: 16,
  },
  sectionMapIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sectionMapEmoji: {
    fontSize: 32,
  },
  completedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FFF',
    borderRadius: 12,
  },
  sectionMapNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 2,
  },
  sectionMapTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  sectionMapTheme: {
    fontSize: 12,
    color: '#64748B',
  },
  sectionMapInfo: {
    flex: 1,
  },
  sectionMapBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currentBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  currentBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  lockBadge: {
    // No margin needed, handled by flex
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
});

