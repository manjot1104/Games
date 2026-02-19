import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;

type Color = 'red' | 'blue' | 'yellow' | 'green';

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const generatePattern = (): Color[] => {
  const patterns: Color[][] = [
    ['red', 'blue', 'red'],
    ['blue', 'red', 'blue'],
    ['red', 'red', 'blue'],
    ['blue', 'blue', 'red'],
    ['red', 'blue', 'blue', 'red'],
    ['blue', 'red', 'red', 'blue'],
    ['red', 'blue', 'yellow', 'red'],
    ['blue', 'green', 'blue'],
  ];
  return patterns[Math.floor(Math.random() * patterns.length)];
};

const ColorPatternMatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [targetPattern, setTargetPattern] = useState<Color[]>([]);
  const [userPattern, setUserPattern] = useState<Color[]>([]);
  const sparkleX = useSharedValue(50);
  const sparkleY = useSharedValue(50);

  const getColorValue = (color: Color): string => {
    switch (color) {
      case 'red': return '#EF4444';
      case 'blue': return '#3B82F6';
      case 'yellow': return '#F59E0B';
      case 'green': return '#10B981';
      default: return '#64748B';
    }
  };

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'colorPatternMatch',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-memory', 'reproduction', 'pattern-copying'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log color pattern match game:', e);
      }

      speakTTS('Pattern matched!', 0.78 );
    },
    [router],
  );

  const handleColorSelect = useCallback((color: Color) => {
    if (!roundActive || done) return;
    
    if (userPattern.length < targetPattern.length) {
      const newPattern = [...userPattern, color];
      setUserPattern(newPattern);

      if (newPattern.length === targetPattern.length) {
        const isCorrect = newPattern.every((p, i) => p === targetPattern[i]);
        
        if (isCorrect) {
          sparkleX.value = 50;
          sparkleY.value = 50;
          setScore(s => {
            const newScore = s + 1;
            if (newScore >= TOTAL_ROUNDS) {
              setTimeout(() => {
                endGame(newScore);
              }, 1000);
            } else {
              setTimeout(() => {
                setRound(r => r + 1);
                const pattern = generatePattern();
                setTargetPattern(pattern);
                setUserPattern([]);
                setRoundActive(true);
              }, 1500);
            }
            return newScore;
          });

          try {
            playSuccess();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {}
        } else {
          setTimeout(() => {
            setUserPattern([]);
            try {
              playWarning();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              speakTTS('Try again!', 0.78 );
            } catch {}
          }, 500);
        }
      }
    }
  }, [roundActive, done, userPattern, targetPattern, endGame, playSuccess, playWarning, sparkleX, sparkleY]);

  useEffect(() => {
    const pattern = generatePattern();
    setTargetPattern(pattern);
    setUserPattern([]);
    setRoundActive(true);
    try {
      speakTTS('Copy the color pattern by tapping colors in order!', 0.78 );
    } catch {}
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🎨</Text>
            <Text style={styles.resultTitle}>Patterns Matched!</Text>
            <Text style={styles.resultSubtitle}>
              You matched {finalStats.correct} patterns out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setRoundActive(true);
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const availableColors: Color[] = ['red', 'blue', 'yellow', 'green'];

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Color Pattern Match</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎨 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Copy the color pattern by tapping colors in order!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.patternSection}>
          <Text style={styles.sectionTitle}>Copy this pattern:</Text>
          <View style={styles.patternBox}>
            <View style={styles.colorPatternRow}>
              {targetPattern.map((color, i) => (
                <View
                  key={i}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: getColorValue(color) },
                  ]}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.patternSection}>
          <Text style={styles.sectionTitle}>Your pattern:</Text>
          <View style={styles.patternBox}>
            <View style={styles.colorPatternRow}>
              {targetPattern.map((_, i) => {
                const userColor = userPattern[i];
                return (
                  <View
                    key={i}
                    style={[
                      styles.colorCircle,
                      {
                        backgroundColor: userColor ? getColorValue(userColor) : '#E2E8F0',
                        borderWidth: userColor ? 0 : 2,
                        borderColor: '#CBD5E1',
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.controlsSection}>
          <Text style={styles.controlsTitle}>Tap to add:</Text>
          <View style={styles.controlsRow}>
            {availableColors.map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  styles.colorButton,
                  { backgroundColor: getColorValue(color) },
                ]}
                onPress={() => handleColorSelect(color)}
                disabled={!roundActive || done || userPattern.length >= targetPattern.length}
              >
                <Text style={styles.colorButtonText}>
                  {color.charAt(0).toUpperCase() + color.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {score > 0 && (
          <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
            <SparkleBurst />
          </Animated.View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: visual memory • reproduction • pattern copying
        </Text>
        <Text style={styles.footerSub}>
          Look at the color pattern and copy it!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    marginBottom: 16,
  },
  patternSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  patternBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  colorPatternRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  colorCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  controlsSection: {
    marginTop: 20,
  },
  controlsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
    textAlign: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  colorButton: {
    width: 80,
    height: 60,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  colorButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default ColorPatternMatchGame;

