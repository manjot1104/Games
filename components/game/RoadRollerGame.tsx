import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming
} from 'react-native-reanimated';
import { SparkleBurst } from './FX';
import ResultCard from './ResultCard';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const RESET_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const ROLLER_SIZE = 80;
const ROAD_WIDTH = 100;
const TOLERANCE = 40;

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

const RoadRollerGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playReset = useSoundEffect(RESET_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isRolling, setIsRolling] = useState(false);
  const [isHorizontal, setIsHorizontal] = useState(true);
  const [progress, setProgress] = useState(0);
  const [showRedAlert, setShowRedAlert] = useState(false);

  const rollerX = useSharedValue(15);
  const rollerY = useSharedValue(50);
  const rollerRotation = useSharedValue(0);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const startX = useSharedValue(15);
  const startY = useSharedValue(50);
  const endX = useSharedValue(85);
  const endY = useSharedValue(50);
  const alertOpacity = useSharedValue(0);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);
  const lastX = useRef(0);
  const lastY = useRef(0);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      // Stop all speech when game ends
      stopAllSpeech();

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'roadRoller',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['directionality', 'start-end-awareness', 'hand-stability', 'straight-line-tracing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log road roller game:', e);
      }

      speakTTS('Road master!', 0.78);
    },
    [router],
  );

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      if (!roundActive || done) return;
      
      // Check if touch started on the roller - only allow dragging if started on roller
      const touchX = (e.x / screenWidth.current) * 100;
      const touchY = (e.y / screenHeight.current) * 100;
      
      // Calculate distance from touch point to roller center
      const rollerCenterX = rollerX.value;
      const rollerCenterY = rollerY.value;
      
      // Convert ROLLER_SIZE from pixels to percentage for comparison
      const rollerSizePercentX = (ROLLER_SIZE / screenWidth.current) * 100;
      const rollerSizePercentY = (ROLLER_SIZE / screenHeight.current) * 100;
      const rollerRadiusX = rollerSizePercentX / 2;
      const rollerRadiusY = rollerSizePercentY / 2;
      
      // Check if touch is within roller bounds
      const distX = Math.abs(touchX - rollerCenterX);
      const distY = Math.abs(touchY - rollerCenterY);
      const isOnRoller = distX <= rollerRadiusX && distY <= rollerRadiusY;
      
      if (!isOnRoller) {
        return; // Don't start rolling if not on roller
      }
      
      setIsRolling(true);
      setShowRedAlert(false);
      alertOpacity.value = 0;
      const startScreenX = (e.x / screenWidth.current) * 100;
      const startScreenY = (e.y / screenHeight.current) * 100;
      lastX.current = startScreenX;
      lastY.current = startScreenY;
    })
    .onUpdate((e) => {
      if (!roundActive || done || !isRolling) return; // Only update if rolling started on roller
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;
      
      // Calculate the line from start to end
      const pathDx = endX.value - startX.value;
      const pathDy = endY.value - startY.value;
      const pathLength = Math.sqrt(pathDx * pathDx + pathDy * pathDy);
      
      if (pathLength > 0) {
        // Project finger position onto the line
        const currentDx = newX - startX.value;
        const currentDy = newY - startY.value;
        const projection = (currentDx * pathDx + currentDy * pathDy) / (pathLength * pathLength);
        
        // Clamp projection to [0, 1] to stay on the line segment
        const clampedProjection = Math.max(0, Math.min(1, projection));
        
        // Calculate projected position on line
        const projectedX = startX.value + clampedProjection * pathDx;
        const projectedY = startY.value + clampedProjection * pathDy;
        
        // Calculate distance from finger to line
        const distanceToLine = Math.sqrt(
          Math.pow(newX - projectedX, 2) + Math.pow(newY - projectedY, 2)
        );
        
        // Check if deviating from path
        if (distanceToLine > TOLERANCE) {
          // Show red alert
          setShowRedAlert(true);
          alertOpacity.value = 1;
          // Don't move the roller if off path
          return;
        } else {
          // Hide alert and allow movement
          setShowRedAlert(false);
          alertOpacity.value = 0;
          
          // Move roller to projected position on line
          rollerX.value = projectedX;
          rollerY.value = projectedY;
          
          // Calculate movement direction for rotation
          const dx = projectedX - lastX.current;
          const dy = projectedY - lastY.current;
          if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            rollerRotation.value = angle;
          }
          
          // Calculate progress
          const totalDist = pathLength;
          const projectedDist = clampedProjection * pathLength;
          setProgress(Math.min(100, Math.max(0, (projectedDist / totalDist) * 100)));
        }
      }
      
      lastX.current = rollerX.value;
      lastY.current = rollerY.value;
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsRolling(false);
      setShowRedAlert(false);
      alertOpacity.value = 0;

      const distance = Math.sqrt(
        Math.pow(rollerX.value - endX.value, 2) + Math.pow(rollerY.value - endY.value, 2)
      );

      if (distance <= TOLERANCE && progress > 80) {
        sparkleX.value = endX.value;
        sparkleY.value = endY.value;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setProgress(0);
              rollerRotation.value = 0;
              rollerX.value = startX.value;
              rollerY.value = startY.value;
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
        rollerRotation.value = 0;
        setProgress(0);
        rollerX.value = startX.value;
        rollerY.value = startY.value;

        try {
          playReset();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Roll along the road!', 0.78);
        } catch {}
      }
    });

  useEffect(() => {
    const horizontal = Math.random() > 0.5;
    setIsHorizontal(horizontal);
    
    if (horizontal) {
      const startXPos = 10 + Math.random() * 10;
      const yPos = 40 + Math.random() * 20;
      startX.value = startXPos;
      startY.value = yPos;
      rollerX.value = startXPos;
      rollerY.value = yPos;
      endX.value = 80 + Math.random() * 15;
      endY.value = yPos;
    } else {
      const xPos = 40 + Math.random() * 20;
      const startYPos = 10 + Math.random() * 10;
      startX.value = xPos;
      startY.value = startYPos;
      rollerX.value = xPos;
      rollerY.value = startYPos;
      endX.value = xPos;
      endY.value = 75 + Math.random() * 15;
    }

    rollerRotation.value = 0;
    setProgress(0);
    lastX.current = rollerX.value;
    lastY.current = rollerY.value;

    try {
      speakTTS('Roll the roller along the straight road!', 0.78);
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

  const rollerStyle = useAnimatedStyle(() => ({
    left: `${rollerX.value}%`,
    top: `${rollerY.value}%`,
    transform: [
      { translateX: -ROLLER_SIZE / 2 },
      { translateY: -ROLLER_SIZE / 2 },
      { rotate: `${rollerRotation.value}deg` },
    ],
  }));

  const roadStyle = useAnimatedStyle(() => {
    if (isHorizontal) {
      return {
        position: 'absolute',
        left: `${Math.min(startX.value, endX.value)}%`,
        top: `${startY.value}%`,
        width: `${Math.abs(endX.value - startX.value)}%`,
        height: ROAD_WIDTH,
        transform: [{ translateY: -ROAD_WIDTH / 2 }],
        backgroundColor: '#6B7280',
      };
    } else {
      return {
        position: 'absolute',
        left: `${startX.value}%`,
        top: `${Math.min(startY.value, endY.value)}%`,
        width: ROAD_WIDTH,
        height: `${Math.abs(endY.value - startY.value)}%`,
        transform: [{ translateX: -ROAD_WIDTH / 2 }],
        backgroundColor: '#6B7280',
      };
    }
  });

  const endMarkerStyle = useAnimatedStyle(() => ({
    left: `${endX.value}%`,
    top: `${endY.value}%`,
    transform: [
      { translateX: -15 },
      { translateY: -15 },
    ],
  }));

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🚧</Text>
            <Text style={styles.resultTitle}>Road master!</Text>
            <Text style={styles.resultSubtitle}>
              You rolled {finalStats.correct} roads out of {finalStats.total}!
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
                setProgress(0);
                rollerRotation.value = 0;
                rollerX.value = startX.value;
                rollerY.value = startY.value;
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Road Roller</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚧 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Roll the roller along the straight road!
        </Text>
      </View>

      <View
        style={styles.playArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.road, roadStyle]} />
            
            <Animated.View style={[styles.endMarker, endMarkerStyle]}>
              <View style={styles.marker}>
                <Text style={styles.markerEmoji}>🏁</Text>
              </View>
            </Animated.View>

            <Animated.View style={[styles.rollerContainer, rollerStyle]}>
              <View style={styles.roller}>
                <Text style={styles.rollerEmoji}>🚧</Text>
              </View>
            </Animated.View>

            {score > 0 && !isRolling && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {showRedAlert && (
              <Animated.View 
                style={[
                  styles.alertContainer,
                  {
                    opacity: alertOpacity,
                  }
                ]}
                pointerEvents="none"
              >
                <View style={styles.alertBox}>
                  <Text style={styles.alertText}>⚠️ Stay on the line!</Text>
                </View>
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: directionality • start-end awareness • hand stability
        </Text>
        <Text style={styles.footerSub}>
          Roll the roller along the straight road to build directionality!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
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
    position: 'relative',
    marginBottom: 16,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  road: {
    borderRadius: 4,
    zIndex: 1,
  },
  rollerContainer: {
    position: 'absolute',
    zIndex: 3,
  },
  roller: {
    width: ROLLER_SIZE,
    height: ROLLER_SIZE,
    borderRadius: ROLLER_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  rollerEmoji: {
    fontSize: 50,
  },
  endMarker: {
    position: 'absolute',
    zIndex: 2,
  },
  marker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#16A34A',
  },
  markerEmoji: {
    fontSize: 20,
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
  alertContainer: {
    position: 'absolute',
    top: '10%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  alertBox: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#DC2626',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  alertText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
});

export default RoadRollerGame;


