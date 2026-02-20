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

const GAMES = [
  { number: 1, name: 'The Intro', description: 'Visual/Auditory introduction', emoji: '👋', color: '#3B82F6' },
  { number: 2, name: 'The Choice', description: 'Receptive selection game', emoji: '👆', color: '#10B981' },
  { number: 3, name: 'The Trace', description: 'Fine motor tracing', emoji: '✏️', color: '#F59E0B' },
  { number: 4, name: 'The Sorter', description: 'Logic and sorting', emoji: '📦', color: '#8B5CF6' },
  { number: 5, name: 'The Celebration', description: 'Boss level review', emoji: '🎉', color: '#EC4899' },
];

// For Level 1, all games are unlocked
const isGameUnlocked = (section: number, level: number, game: number): boolean => {
  if (section === 1 && level === 1) {
    return true; // All games unlocked for Level 1
  }
  // Future: Check if previous game is completed
  return false;
};

interface GameSelectorProps {
  section: number;
  level: number;
  onBack: () => void;
  onSelectGame: (game: number) => void;
}

export function GameSelector({ section, level, onBack, onSelectGame }: GameSelectorProps) {
  const { progress } = useSpecialEducationProgress();
  const sectionData = progress?.sections.find((s) => s.sectionNumber === section);
  const levelData = sectionData?.levels.find((l) => l.levelNumber === level);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Level {level}</Text>
          <Text style={styles.headerSubtitle}>Section {section}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.infoBanner}>
          <Text style={styles.infoTitle}>5 Games in This Level</Text>
          <Text style={styles.infoDescription}>
            Complete all 5 games to finish this level and unlock the next one!
          </Text>
        </View>

        <View style={styles.gamesList}>
          {GAMES.map((game) => {
            const gameData = levelData?.games.find((g) => g.gameNumber === game.number);
            const unlocked = isGameUnlocked(section, level, game.number) || isUnlocked(progress, section, level, game.number);
            const completed = gameData?.completed || false;
            
            return (
            <TouchableOpacity
              key={game.number}
              style={[
                styles.gameCard,
                !unlocked && styles.gameCardLocked,
                unlocked && { borderColor: game.color },
                completed && { borderWidth: 3 },
              ]}
              onPress={() => unlocked && onSelectGame(game.number)}
              disabled={!unlocked}
              activeOpacity={0.8}
            >
              <View style={[styles.gameIcon, { backgroundColor: `${game.color}20` }]}>
                <Text style={styles.gameEmoji}>{game.emoji}</Text>
                {completed && (
                  <View style={styles.completedBadge}>
                    <Ionicons name="checkmark-circle" size={16} color={game.color} />
                  </View>
                )}
              </View>
              <View style={styles.gameInfo}>
                <Text style={styles.gameName}>{game.name}</Text>
                <Text style={styles.gameDescription}>{game.description}</Text>
                {completed && gameData?.accuracy && (
                  <Text style={styles.accuracyText}>Accuracy: {gameData.accuracy}%</Text>
                )}
              </View>
              {!unlocked ? (
                <Ionicons name="lock-closed" size={20} color="#9CA3AF" />
              ) : completed ? (
                <Ionicons name="checkmark-circle" size={24} color={game.color} />
              ) : (
                <Ionicons name="play-circle" size={24} color={game.color} />
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
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  infoBanner: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#E2E8F0',
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
  gamesList: {
    gap: 12,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  gameCardLocked: {
    backgroundColor: '#F8FAFC',
    opacity: 0.6,
    borderColor: '#E5E7EB',
  },
  gameIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameEmoji: {
    fontSize: 28,
  },
  gameInfo: {
    flex: 1,
  },
  gameName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  gameDescription: {
    fontSize: 12,
    color: '#64748B',
  },
  completedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FFF',
    borderRadius: 10,
  },
  accuracyText: {
    fontSize: 10,
    color: '#10B981',
    fontWeight: '700',
    marginTop: 4,
  },
});

