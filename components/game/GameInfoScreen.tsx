/**
 * GameInfoScreen Component
 * Shows game information before starting a game
 * Displays: What the game does, skills developed, who should play it
 */

import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type GameInfoProps = {
  title: string;
  emoji: string;
  description: string;
  skills: string[];
  suitableFor: string;
  onStart: () => void;
  onBack: () => void;
};

export default function GameInfoScreen({
  title,
  emoji,
  description,
  skills,
  suitableFor,
  onStart,
  onBack,
}: GameInfoProps) {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#E0F2FE', '#DBEAFE', '#BFDBFE']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Back Button */}
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          {/* Emoji */}
          <View style={styles.emojiContainer}>
            <Text style={styles.emoji}>{emoji}</Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>{title}</Text>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 What Happens:</Text>
            <Text style={styles.sectionText}>{description}</Text>
          </View>

          {/* Skills Developed */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>✨ What Develops:</Text>
            <View style={styles.skillsList}>
              {skills.map((skill, index) => (
                <View key={index} style={styles.skillItem}>
                  <Text style={styles.skillBullet}>✔</Text>
                  <Text style={styles.skillText}>{skill}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Suitable For */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>👶 Who Should Play This Game:</Text>
            <Text style={styles.sectionText}>{suitableFor}</Text>
          </View>

          {/* Start Button */}
          <TouchableOpacity style={styles.startButton} onPress={onStart} activeOpacity={0.8}>
            <LinearGradient
              colors={['#3B82F6', '#2563EB']}
              style={styles.startButtonGradient}
            >
              <Text style={styles.startButtonText}>🎮 Start Game</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 100,
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 100,
  },
  content: {
    alignItems: 'center',
  },
  emojiContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    borderWidth: 3,
    borderColor: '#DBEAFE',
  },
  emoji: {
    fontSize: 64,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 32,
    textAlign: 'center',
  },
  section: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 12,
  },
  sectionText: {
    fontSize: 16,
    color: '#475569',
    lineHeight: 24,
    fontWeight: '500',
  },
  skillsList: {
    marginTop: 8,
  },
  skillItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  skillBullet: {
    fontSize: 18,
    color: '#22C55E',
    marginRight: 12,
    marginTop: 2,
  },
  skillText: {
    flex: 1,
    fontSize: 16,
    color: '#475569',
    lineHeight: 24,
    fontWeight: '500',
  },
  startButton: {
    width: '100%',
    maxWidth: 400,
    marginTop: 24,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  startButtonGradient: {
    paddingVertical: 18,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});

