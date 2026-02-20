import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSpecialEducationProgress, isUnlocked } from './shared/SpecialEducationProgress';

const SECTION_INFO: { [key: number]: { title: string; theme: string; emoji: string; color: string } } = {
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

interface LevelSelectorProps {
  section: number;
  onBack: () => void;
  onSelectLevel: (level: number) => void;
  onShowMap: () => void;
}

export function LevelSelector({ section, onBack, onSelectLevel, onShowMap }: LevelSelectorProps) {
  const sectionInfo = SECTION_INFO[section] || SECTION_INFO[1];
  const { progress } = useSpecialEducationProgress();
  const levels = Array.from({ length: 10 }, (_, i) => i + 1);
  
  const sectionData = progress?.sections.find((s) => s.sectionNumber === section);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>{sectionInfo.title}</Text>
          <Text style={styles.headerSubtitle}>Section {section} • {sectionInfo.theme}</Text>
        </View>
        <TouchableOpacity onPress={onShowMap} style={styles.mapButton}>
          <Ionicons name="map" size={24} color={sectionInfo.color} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.infoBanner}>
          <Text style={styles.infoEmoji}>{sectionInfo.emoji}</Text>
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>10 Levels Available</Text>
            <Text style={styles.infoDescription}>
              Each level has 5 games: Intro, Choice, Trace, Sorter, and Celebration
            </Text>
          </View>
        </View>

        <View style={styles.levelsGrid}>
          {levels.map((level) => {
            const levelData = sectionData?.levels.find((l) => l.levelNumber === level);
            const unlocked = isUnlocked(progress, section, level, 1) || level === 1; // For POC, only level 1 is unlocked
            const completed = levelData?.completed || false;
            return (
              <TouchableOpacity
                key={level}
              style={[
                styles.levelCard,
                unlocked ? styles.levelCardUnlocked : styles.levelCardLocked,
                unlocked && { borderColor: sectionInfo.color },
                completed && { borderWidth: 3 },
              ]}
              onPress={() => unlocked && onSelectLevel(level)}
              disabled={!unlocked}
              activeOpacity={0.8}
            >
              <View style={[styles.levelIcon, { backgroundColor: `${sectionInfo.color}20` }]}>
                <Text style={styles.levelNumber}>{level}</Text>
                {completed && (
                  <View style={styles.completedBadge}>
                    <Ionicons name="checkmark-circle" size={16} color={sectionInfo.color} />
                  </View>
                )}
              </View>
              <Text style={styles.levelLabel}>Level {level}</Text>
              {!unlocked && (
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={12} color="#9CA3AF" />
                </View>
              )}
            </TouchableOpacity>
            );
          })}
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
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  mapButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 12,
  },
  infoEmoji: {
    fontSize: 40,
  },
  infoText: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  infoDescription: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  levelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  levelCard: {
    width: '31%',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  levelCardUnlocked: {
    borderColor: '#E2E8F0',
  },
  levelCardLocked: {
    backgroundColor: '#F8FAFC',
    opacity: 0.6,
    borderColor: '#E5E7EB',
  },
  levelIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  levelNumber: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  levelLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  lockBadge: {
    marginTop: 4,
  },
  completedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FFF',
    borderRadius: 10,
  },
});

