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

const SECTIONS = [
  { number: 1, title: 'The Explorer', theme: 'Forest', emoji: '🌲', color: '#10B981' },
  { number: 2, title: 'The Matcher', theme: 'Ocean', emoji: '🌊', color: '#0EA5E9', locked: true },
  { number: 3, title: 'The Builder', theme: 'Mountain', emoji: '⛰️', color: '#8B5CF6', locked: true },
  { number: 4, title: 'The Grouper', theme: 'Desert', emoji: '🏜️', color: '#F59E0B', locked: true },
  { number: 5, title: 'The Counter', theme: 'Sky', emoji: '☁️', color: '#3B82F6', locked: true },
  { number: 6, title: 'The Logic Lab', theme: 'City', emoji: '🏙️', color: '#6366F1', locked: true },
  { number: 7, title: 'The Reader', theme: 'Space', emoji: '🚀', color: '#8B5CF6', locked: true },
  { number: 8, title: 'The Citizen', theme: 'Planet', emoji: '🪐', color: '#EC4899', locked: true },
  { number: 9, title: 'The Clockwise', theme: 'Galaxy', emoji: '🌌', color: '#6366F1', locked: true },
  { number: 10, title: 'The Graduate', theme: 'Space Station', emoji: '🛸', color: '#8B5CF6', locked: true },
];

interface SectionSelectorProps {
  onSelectSection: (section: number) => void;
  onShowMap: () => void;
}

export function SectionSelector({ onSelectSection, onShowMap }: SectionSelectorProps) {
  const { progress } = useSpecialEducationProgress();

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.introSection}>
        <Text style={styles.introTitle}>Learn English & Math</Text>
        <Text style={styles.introDescription}>
          Journey through 10 sections, each with 10 levels and 5 games. Start with Section 1: The Explorer to learn letters and numbers!
        </Text>
      </View>

        <View style={styles.sectionsGrid}>
          {SECTIONS.map((section) => {
            const sectionData = progress?.sections.find((s) => s.sectionNumber === section.number);
            const unlocked = sectionData?.unlocked || section.number === 1;
            const completed = sectionData?.completed || false;
            
            return (
            <TouchableOpacity
              key={section.number}
              style={[
                styles.sectionCard,
                !unlocked && styles.sectionCardLocked,
                { borderColor: section.color },
                completed && { borderWidth: 3 },
              ]}
              onPress={() => unlocked && onSelectSection(section.number)}
              disabled={!unlocked}
              activeOpacity={0.8}
            >
            <View style={[styles.sectionIcon, { backgroundColor: `${section.color}20` }]}>
              <Text style={styles.sectionEmoji}>{section.emoji}</Text>
            </View>
            <Text style={styles.sectionNumber}>Section {section.number}</Text>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionTheme}>{section.theme}</Text>
            {completed && (
              <View style={[styles.completedBadge, { backgroundColor: `${section.color}20` }]}>
                <Ionicons name="checkmark-circle" size={14} color={section.color} />
                <Text style={[styles.completedText, { color: section.color }]}>Completed</Text>
              </View>
            )}
            {!unlocked && (
              <View style={styles.lockBadge}>
                <Ionicons name="lock-closed" size={14} color="#9CA3AF" />
                <Text style={styles.lockText}>Locked</Text>
              </View>
            )}
          </TouchableOpacity>
            );
          })}
      </View>

      <TouchableOpacity style={styles.mapButton} onPress={onShowMap}>
        <Ionicons name="map" size={20} color="#8B5CF6" />
        <Text style={styles.mapButtonText}>View Progress Map</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  introSection: {
    marginBottom: 24,
  },
  introTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  introDescription: {
    fontSize: 16,
    color: '#475569',
    lineHeight: 24,
  },
  sectionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  sectionCard: {
    width: '48%',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sectionCardLocked: {
    backgroundColor: '#F8FAFC',
    opacity: 0.6,
  },
  sectionIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  sectionEmoji: {
    fontSize: 32,
  },
  sectionNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  sectionTheme: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
  },
  lockText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '700',
    marginLeft: 4,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  completedText: {
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 4,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#8B5CF6',
    gap: 8,
  },
  mapButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8B5CF6',
  },
});

