import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SectionSelector } from './SectionSelector';
import { LevelSelector } from './LevelSelector';
import { GameSelector } from './GameSelector';
import { ProgressMap } from './ProgressMap';
import { Game1Intro } from './games/section1/level1/Game1Intro';
import { Game2Choice } from './games/section1/level1/Game2Choice';
import { Game3Trace } from './games/section1/level1/Game3Trace';
import { Game4Sorter } from './games/section1/level1/Game4Sorter';
import { Game5Celebration } from './games/section1/level1/Game5Celebration';

type NavigationMode = 'sections' | 'levels' | 'games' | 'map' | 'playing';

export function SpecialEducationNavigator() {
  const router = useRouter();
  const [mode, setMode] = useState<NavigationMode>('sections');
  const [selectedSection, setSelectedSection] = useState<number | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [selectedGame, setSelectedGame] = useState<number | null>(null);

  const handleBack = () => {
    if (mode === 'levels') {
      setMode('sections');
      setSelectedSection(null);
    } else if (mode === 'games') {
      setMode('levels');
      setSelectedLevel(null);
    } else {
      router.back();
    }
  };

  const handleSelectSection = (section: number) => {
    setSelectedSection(section);
    setMode('levels');
  };

  const handleSelectLevel = (level: number) => {
    setSelectedLevel(level);
    setMode('games');
  };

  const handleSelectGame = (game: number) => {
    // All 5 games are available for Section 1, Level 1
    if (selectedSection === 1 && selectedLevel === 1 && game >= 1 && game <= 5) {
      setSelectedGame(game);
      setMode('playing');
    }
  };

  const handleGameComplete = () => {
    // Return to game selector after game completion
    setSelectedGame(null);
    setMode('games');
  };

  const handleShowMap = () => {
    setMode('map');
  };

  if (mode === 'map') {
    return (
      <ProgressMap
        onBack={() => setMode('sections')}
        currentSection={selectedSection || 1}
      />
    );
  }

  if (mode === 'levels' && selectedSection !== null) {
    return (
      <LevelSelector
        section={selectedSection}
        onBack={handleBack}
        onSelectLevel={handleSelectLevel}
        onShowMap={handleShowMap}
      />
    );
  }

  if (mode === 'games' && selectedSection !== null && selectedLevel !== null) {
    return (
      <GameSelector
        section={selectedSection}
        level={selectedLevel}
        onBack={handleBack}
        onSelectGame={handleSelectGame}
      />
    );
  }

  if (mode === 'playing' && selectedSection === 1 && selectedLevel === 1 && selectedGame !== null) {
    const gameProps = {
      onBack: () => setMode('games'),
      onComplete: handleGameComplete,
      section: selectedSection,
      level: selectedLevel,
    };

    switch (selectedGame) {
      case 1:
        return <Game1Intro {...gameProps} />;
      case 2:
        return <Game2Choice {...gameProps} />;
      case 3:
        return <Game3Trace {...gameProps} />;
      case 4:
        return <Game4Sorter {...gameProps} />;
      case 5:
        return <Game5Celebration {...gameProps} />;
      default:
        return null;
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Special Education</Text>
        <TouchableOpacity onPress={handleShowMap} style={styles.mapButton}>
          <Ionicons name="map" size={24} color="#8B5CF6" />
        </TouchableOpacity>
      </View>

      <SectionSelector
        onSelectSection={handleSelectSection}
        onShowMap={handleShowMap}
      />
    </SafeAreaView>
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
  mapButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

