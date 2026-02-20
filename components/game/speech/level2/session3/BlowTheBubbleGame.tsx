/**
 * Blow the Bubble Game
 * Child blows to make bubble grow, then it pops
 */

import BlowMeter from '@/components/game/BlowMeter';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import { logGameAndAward } from '@/utils/api';
import { BlowDetector } from '@/utils/blowDetection';
import { DEFAULT_TTS_RATE, speak as speakTTS, stopTTS } from '@/utils/tts';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

// Conditional import for VisionCamera
let Camera: any = null;
if (Platform.OS !== 'web') {
  try {
    const visionCamera = require('react-native-vision-camera');
    Camera = visionCamera.Camera;
  } catch (e) {
    console.warn('react-native-vision-camera not available:', e);
  }
}

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

interface RoundResult {
  round: number;
  stars: number;
  maxSize: number; // Percentage of max size reached
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 30000; // 30 seconds per round
const MAX_BUBBLE_SIZE = 200; // pixels
const MIN_BUBBLE_SIZE = 40; // pixels
const BAR_FILL_THRESHOLD = 0.75; // Bar must be 75% filled before bubble grows

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    stopTTS();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('speak error', e);
  }
}

export function BlowTheBubbleGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const isMobile = screenWidth < 600;
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
  } = jawDetection;

  // Web-only properties (type assertion needed)
  const protrusion = (jawDetection as any).protrusion as number | undefined;
  const cheekExpansion = (jawDetection as any).cheekExpansion as number | undefined;
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;
  const landmarks = (jawDetection as any).landmarks as any | undefined;
  const previewRef = useRef<View>(null);

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [bubbleSize, setBubbleSize] = useState(MIN_BUBBLE_SIZE);
  const [bubblePopped, setBubblePopped] = useState(false);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    averageSize: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const blowDetector = useRef(new BlowDetector(800, 0.25)); // Lowered protrusion threshold from 0.4 to 0.25
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bubbleSizeAnim = useRef(new Animated.Value(MIN_BUBBLE_SIZE)).current;
  const bubbleOpacity = useRef(new Animated.Value(1)).current;
  const popParticles = useRef<Array<{ id: number; x: number; y: number; vx: number; vy: number; opacity: Animated.Value }>>([]).current;

  // Debug: Log landmarks when they change (throttled to avoid spam)
  const lastLogTime = useRef(0);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const now = Date.now();
      if (now - lastLogTime.current > 1000) { // Log every 1 second
        lastLogTime.current = now;
        console.log('🔍 Landmarks Debug:', {
          hasLandmarks: !!landmarks,
          landmarksType: typeof landmarks,
          landmarksValue: landmarks,
          isDetecting,
          allMouthLandmarks: landmarks?.allMouthLandmarks?.length || 0,
          upperLip: landmarks?.upperLip?.length || 0,
          lowerLip: landmarks?.lowerLip?.length || 0,
          mouthLeft: !!landmarks?.mouthLeft,
          mouthRight: !!landmarks?.mouthRight,
          samplePoint: landmarks?.allMouthLandmarks?.[0] || landmarks?.upperLip?.[0] || landmarks?.lowerLip?.[0],
        });
      }
    }
  }, [landmarks, isDetecting]);

  // Update blow detection
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting) return;

    const protrusionValue = (protrusion as number) || 0;
    const cheekExpansionValue = (cheekExpansion as number) || 0;
    const blowState = blowDetector.current.update(isOpen || false, protrusionValue, ratio || 0, cheekExpansionValue);

    // Only grow bubble when bar is filled (intensity >= threshold) AND sustained
    const isBarFilled = blowState.intensity >= BAR_FILL_THRESHOLD;
    
    if (blowState.isSustained && isBarFilled && !bubblePopped) {
      // Grow bubble based on blow intensity
      // Higher intensity = faster growth (scaled by how much over threshold)
      const intensityMultiplier = Math.max(1, blowState.intensity / BAR_FILL_THRESHOLD);
      const growthRate = blowState.intensity * 2 * intensityMultiplier; // pixels per frame
      setBubbleSize(prev => {
        const newSize = Math.min(MAX_BUBBLE_SIZE, prev + growthRate);
        if (newSize >= MAX_BUBBLE_SIZE && !bubblePopped) {
          // Bubble reached max size, pop it
          setTimeout(() => {
            popBubble();
          }, 100);
        }
        return newSize;
      });
    }
  }, [isOpen, protrusion, ratio, isDetecting, gameState, bubblePopped]);

  // Animate bubble size
  useEffect(() => {
    Animated.timing(bubbleSizeAnim, {
      toValue: bubbleSize,
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [bubbleSize]);

  // Pop bubble function
  const popBubble = useCallback(() => {
    if (bubblePopped) return;
    setBubblePopped(true);

    // Create pop particles
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20;
      const speed = 3 + Math.random() * 2;
      popParticles.push({
        id: i,
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        opacity: new Animated.Value(1),
      });
    }

    // Animate bubble pop
    Animated.sequence([
      Animated.timing(bubbleSizeAnim, {
        toValue: bubbleSize * 1.3,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.parallel([
        Animated.timing(bubbleOpacity, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bubbleSizeAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    ]).start();

    // Animate particles
    popParticles.forEach(particle => {
      Animated.parallel([
        Animated.timing(particle.opacity, {
          toValue: 0,
          duration: 1000,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });

    speak('Pop! Great job!');
    endRound();
  }, [bubbleSize, bubblePopped, screenWidth, screenHeight]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    blowDetector.current.reset();
    setBubbleSize(MIN_BUBBLE_SIZE);
    setBubblePopped(false);
    setTimeElapsed(0);
    bubbleSizeAnim.setValue(MIN_BUBBLE_SIZE);
    bubbleOpacity.setValue(1);
    popParticles.length = 0;

    if (currentRound === 1) {
      speak(
        'Welcome to Blow the Bubble! Blow into your device to make the bubble grow. ' +
        'Keep blowing until the bubble pops! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound]);

  // Start countdown
  const startCountdown = useCallback(() => {
    setGameState('countdown');
    setCountdown(3);
    speak('Get ready!');

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          startRound();
          return 0;
        }
        speak(prev - 1 === 0 ? 'Go! Blow the bubble!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setBubbleSize(MIN_BUBBLE_SIZE);
    setBubblePopped(false);
    setTimeElapsed(0);
    bubbleSizeAnim.setValue(MIN_BUBBLE_SIZE);
    bubbleOpacity.setValue(1);
    popParticles.length = 0;
    blowDetector.current.reset();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      // Timeout after 30 seconds
      if (elapsed >= ROUND_TIME_MS / 1000 && !bubblePopped) {
        endRound();
      }
    }, 100);
  }, [bubblePopped]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const maxSizePercent = (bubbleSize / MAX_BUBBLE_SIZE) * 100;
    let stars = 0;

    if (bubblePopped && timeElapsed < 10) {
      stars = 3;
    } else if (bubblePopped && timeElapsed < 20) {
      stars = 2;
    } else if (maxSizePercent >= 75) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      maxSize: maxSizePercent,
      timeElapsed,
    };

    setRoundResults(prev => [...prev, result]);
    setTotalStars(prev => prev + stars);

    // Show success animation instead of TTS
    setShowRoundSuccess(true);
    setGameState('roundComplete');

    // Wait for animation to complete before moving to next round
    setTimeout(() => {
      setShowRoundSuccess(false);
      if (currentRound < requiredRounds) {
        setCurrentRound(prev => prev + 1);
        // Add a small delay before starting calibration to prevent immediate auto-start
        setTimeout(() => {
          startCalibration();
        }, 500);
      } else {
        finishGame();
      }
    }, 2500);
  }, [currentRound, bubbleSize, bubblePopped, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const averageSize = roundResults.reduce((sum, r) => sum + r.maxSize, 0) / roundResults.length;
    const accuracy = Math.round(averageSize);

    const stats = {
      totalRounds: requiredRounds,
      averageSize,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);
    setShowCongratulations(true);

    speak(`Amazing! You completed all ${requiredRounds} rounds with ${totalStars} total stars!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'blow-the-bubble',
        correct: totalStars,
        total: requiredRounds * 3,
        accuracy,
        xpAwarded,
        skillTags: ['airflow', 'oral-motor', 'breath-control', 'coordination'],
        meta: {
          totalRounds: requiredRounds,
          averageSize,
          totalStars,
          roundResults,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [roundResults, totalStars, onComplete, requiredRounds]);

  // Check for face detection to start countdown
  // Use a ref to track if we've already triggered countdown for this calibration phase
  const calibrationStartedRef = useRef(false);
  
  useEffect(() => {
    if (gameState === 'calibration') {
      // Reset the flag when entering calibration
      calibrationStartedRef.current = false;
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === 'calibration' && isDetecting && hasCamera && !calibrationStartedRef.current) {
      calibrationStartedRef.current = true;
      // Add a longer delay (2 seconds) to give user time to see the calibration screen
      const timeoutId = setTimeout(() => {
        // Use a ref check to ensure we're still in calibration state
        // This prevents starting countdown if state changed during the delay
        if (calibrationStartedRef.current) {
          startCountdown();
        }
      }, 2000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [gameState, isDetecting, hasCamera, startCountdown]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      clearScheduledSpeech();
    };
  }, []);

  // Initialize
  useEffect(() => {
    startCalibration();
  }, [startCalibration]);

  // Ensure container has data-native-id attribute for hook to find it (web only)
  useEffect(() => {
    if (Platform.OS !== 'web' || !previewContainerId) return;
    
    const setAttribute = () => {
      try {
        // Try to find container by nativeID first
        let element = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
        
        // If not found, try data-native-id
        if (!element) {
          element = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
        }
        
        // If still not found, try via ref
        if (!element && previewRef.current) {
          try {
            const refElement = (previewRef.current as any)?.current || 
                              (previewRef.current as any)?.base || 
                              previewRef.current;
            if (refElement && refElement.nodeType === 1) {
              element = refElement;
            }
          } catch (e) {
            // Ignore
          }
        }
        
        // Set data-native-id attribute if element found and doesn't have it
        if (element && !element.getAttribute('data-native-id')) {
          element.setAttribute('data-native-id', previewContainerId);
        }
      } catch (e) {
        // Silently fail - hook will try other methods
      }
    };
    
    // Try immediately and with delays to catch element when mounted
    setAttribute();
    const timeouts = [100, 500, 1000, 2000].map(delay => 
      setTimeout(setAttribute, delay)
    );
    
    return () => timeouts.forEach(clearTimeout);
  }, [previewContainerId]);

  // Ensure video is in the correct full-screen container and remove duplicates (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const moveVideoToContainer = () => {
      // Find our full-screen container
      let container = document.querySelector(`[data-native-id="${previewContainerId}"]`) as HTMLElement;
      
      // Also try by nativeID attribute
      if (!container) {
        container = document.querySelector(`[nativeID="${previewContainerId}"]`) as HTMLElement;
      }
      
      // Also try to find it via the ref
      if (!container && previewRef.current) {
        try {
          const refElement = (previewRef.current as any)?.current || 
                            (previewRef.current as any)?.base || 
                            previewRef.current;
          if (refElement && refElement.nodeType === 1) {
            container = refElement;
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!container) return;

      // Validate container is full-screen (must be >70% of screen size)
      const rect = container.getBoundingClientRect();
      const isFullScreen = rect.width > window.innerWidth * 0.7 && 
                           rect.height > window.innerHeight * 0.7;
      
      if (!isFullScreen) {
        // Not the right container, keep looking
        return;
      }

      // Find all video elements with the preview attribute
      const allVideos = document.querySelectorAll('video[data-jaw-preview-video]');
      
      let videoInContainer: HTMLVideoElement | null = null;
      const videosToRemove: HTMLVideoElement[] = [];
      
      allVideos.forEach((video) => {
        const videoElement = video as HTMLVideoElement;
        if (container.contains(videoElement)) {
          videoInContainer = videoElement;
        } else {
          // Video is in wrong container - mark for removal
          videosToRemove.push(videoElement);
        }
      });

      // If no video in our container, move the first one we find
      if (!videoInContainer && allVideos.length > 0) {
        const videoToMove = allVideos[0] as HTMLVideoElement;
        // Remove from current parent (check if it's actually a child first)
        if (videoToMove.parentElement && videoToMove.parentElement.contains(videoToMove)) {
          videoToMove.parentElement.removeChild(videoToMove);
        }
        // Add to our container
        container.appendChild(videoToMove);
        videoInContainer = videoToMove;
      }

      // Remove duplicate videos (check if they're actually children first)
      videosToRemove.forEach(video => {
        if (video.parentElement && video.parentElement.contains(video)) {
          video.parentElement.removeChild(video);
        }
      });

      // Ensure video in our container is properly styled
      if (videoInContainer) {
        videoInContainer.style.display = 'block';
        videoInContainer.style.position = 'absolute';
        videoInContainer.style.opacity = '1';
        videoInContainer.style.width = '100%';
        videoInContainer.style.height = '100%';
        videoInContainer.style.objectFit = 'cover';
        videoInContainer.style.top = '0';
        videoInContainer.style.left = '0';
        videoInContainer.style.right = '0';
        videoInContainer.style.bottom = '0';
        videoInContainer.style.zIndex = '1';
        videoInContainer.style.borderRadius = '0';
      }

      // Ensure container is full screen and visible
      (container as any).style.position = 'absolute';
      (container as any).style.top = '0';
      (container as any).style.left = '0';
      (container as any).style.right = '0';
      (container as any).style.bottom = '0';
      (container as any).style.width = '100%';
      (container as any).style.height = '100%';
      (container as any).style.zIndex = '1';
      (container as any).style.display = 'block';
      (container as any).style.visibility = 'visible';
      (container as any).style.opacity = '1';
    };

    // Run immediately and periodically (increased frequency to 200ms)
    moveVideoToContainer();
    const interval = setInterval(moveVideoToContainer, 200);

    return () => clearInterval(interval);
  }, [previewContainerId, hasCamera, previewRef]);

  const blowState = blowDetector.current.update(
    isOpen || false,
    (protrusion as number) || 0,
    ratio || 0,
    (cheekExpansion as number) || 0
  );

  // Show congratulations screen with stats
  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Blowing!"
        showButtons={true}
        correct={finalStats.totalStars}
        total={requiredRounds * 3}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.totalStars * 50}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.playArea}>
        {/* Full Screen Camera Preview */}
        {hasCamera && (
          <View style={styles.fullScreenCamera}>
            {Platform.OS === 'web' ? (
              <View
                ref={previewRef}
                style={[
                  StyleSheet.absoluteFill, 
                  { 
                    backgroundColor: '#000000',
                  }
                ]}
                nativeID={previewContainerId}
                collapsable={false}
              >
                {!isDetecting && (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 16 }}>Loading camera...</Text>
                  </View>
                )}
              </View>
            ) : (
              jawDetection.device && Camera && (
                <Camera
                  style={StyleSheet.absoluteFill}
                  device={jawDetection.device}
                  isActive={gameState === 'playing' || gameState === 'calibration'}
                  frameProcessor={jawDetection.frameProcessor}
                  frameProcessorFps={30}
                />
              )
            )}
          </View>
        )}

        {/* Always visible test dot - placed at top level to ensure it renders */}
        <View
          style={[
            styles.landmarkTestDot,
            {
              position: 'absolute',
              left: screenWidth / 2 - 15,
              top: screenHeight / 2 - 15,
              zIndex: 9999,
            },
          ]}
        />

        {/* Overlay UI Elements */}
        <View style={styles.overlayContainer}>
        {/* Mouth Landmarks Overlay - Always show test dot, show landmarks when available */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          
          {/* Test indicator to verify overlay is rendering */}
          {Platform.OS === 'web' && (
            <View style={styles.landmarkTestIndicator}>
              <Text style={styles.landmarkTestText}>
                Landmarks: {landmarks?.allMouthLandmarks?.length || 0} points{'\n'}
                IsDetecting: {isDetecting ? 'Yes' : 'No'}{'\n'}
                HasLandmarks: {landmarks ? 'Yes' : 'No'}{'\n'}
                Landmarks Type: {typeof landmarks}{'\n'}
                UpperLip: {landmarks?.upperLip?.length || 0}{'\n'}
                LowerLip: {landmarks?.lowerLip?.length || 0}
              </Text>
            </View>
          )}
          
          {/* Only render landmarks if they exist */}
          {landmarks && (
            <>
              {/* Draw all mouth landmarks as green dots */}
              {landmarks.allMouthLandmarks && Array.isArray(landmarks.allMouthLandmarks) && landmarks.allMouthLandmarks.length > 0 ? (
              landmarks.allMouthLandmarks.map((point: { x: number; y: number } | null | undefined, index: number) => {
                if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
                // Convert normalized coordinates (0-1) to screen coordinates
                const screenX = point.x * screenWidth;
                const screenY = point.y * screenHeight;
                // Validate coordinates are within screen bounds (with some margin)
                if (screenX < -50 || screenX > screenWidth + 50 || screenY < -50 || screenY > screenHeight + 50) return null;
                return (
                  <View
                    key={`landmark-${index}`}
                    style={[
                      styles.landmarkDot,
                      {
                        left: screenX - 4,
                        top: screenY - 4,
                      },
                    ]}
                  />
                );
              })
            ) : (
              // Fallback: Try to draw from upperLip and lowerLip if allMouthLandmarks is not available
              <>
                {landmarks.upperLip && Array.isArray(landmarks.upperLip) && landmarks.upperLip.map((point: { x: number; y: number } | null | undefined, index: number) => {
                  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
                  const screenX = point.x * screenWidth;
                  const screenY = point.y * screenHeight;
                  return (
                    <View
                      key={`upper-fallback-${index}`}
                      style={[
                        styles.landmarkDot,
                        styles.landmarkUpper,
                        {
                          left: screenX - 5,
                          top: screenY - 5,
                        },
                      ]}
                    />
                  );
                })}
                {landmarks.lowerLip && Array.isArray(landmarks.lowerLip) && landmarks.lowerLip.map((point: { x: number; y: number } | null | undefined, index: number) => {
                  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
                  const screenX = point.x * screenWidth;
                  const screenY = point.y * screenHeight;
                  return (
                    <View
                      key={`lower-fallback-${index}`}
                      style={[
                        styles.landmarkDot,
                        styles.landmarkLower,
                        {
                          left: screenX - 5,
                          top: screenY - 5,
                        },
                      ]}
                    />
                  );
                })}
              </>
            )}
            {/* Highlight key corner points with magenta color */}
            {landmarks.mouthLeft && landmarks.mouthLeft.x !== undefined && landmarks.mouthLeft.y !== undefined && (
              <View
                style={[
                  styles.landmarkDot,
                  styles.landmarkKey,
                  {
                    left: landmarks.mouthLeft.x * screenWidth - 6,
                    top: landmarks.mouthLeft.y * screenHeight - 6,
                  },
                ]}
              />
            )}
            {landmarks.mouthRight && landmarks.mouthRight.x !== undefined && landmarks.mouthRight.y !== undefined && (
              <View
                style={[
                  styles.landmarkDot,
                  styles.landmarkKey,
                  {
                    left: landmarks.mouthRight.x * screenWidth - 6,
                    top: landmarks.mouthRight.y * screenHeight - 6,
                  },
                ]}
              />
            )}
            {/* Highlight upper lip points in cyan */}
            {landmarks.upperLip && Array.isArray(landmarks.upperLip) && landmarks.upperLip.length > 0 && landmarks.upperLip.map((point: { x: number; y: number } | null | undefined, index: number) => {
              if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
              const screenX = point.x * screenWidth;
              const screenY = point.y * screenHeight;
              if (screenX < 0 || screenX > screenWidth || screenY < 0 || screenY > screenHeight) return null;
              return (
                <View
                  key={`upper-${index}`}
                  style={[
                    styles.landmarkDot,
                    styles.landmarkUpper,
                    {
                      left: screenX - 5,
                      top: screenY - 5,
                    },
                  ]}
                />
              );
            })}
            {/* Highlight lower lip points in yellow */}
            {landmarks.lowerLip && Array.isArray(landmarks.lowerLip) && landmarks.lowerLip.length > 0 && landmarks.lowerLip.map((point: { x: number; y: number } | null | undefined, index: number) => {
              if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
              const screenX = point.x * screenWidth;
              const screenY = point.y * screenHeight;
              if (screenX < 0 || screenX > screenWidth || screenY < 0 || screenY > screenHeight) return null;
              return (
                <View
                  key={`lower-${index}`}
                  style={[
                    styles.landmarkDot,
                    styles.landmarkLower,
                    {
                      left: screenX - 5,
                      top: screenY - 5,
                    },
                  ]}
                />
              );
            })}
            </>
          )}
        </View>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#FFF" />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.roundText}>Round {currentRound} of {requiredRounds}</Text>
            <View style={styles.starsContainer}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={20}
                  color={i < Math.floor(totalStars / currentRound) ? '#FFD700' : '#FFF'}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Blow Meter */}
        {gameState === 'playing' && (
          <View style={styles.meterContainer}>
            <BlowMeter 
              intensity={blowState.intensity} 
              isBlowing={blowState.isBlowing}
              threshold={BAR_FILL_THRESHOLD}
            />
            {/* Feedback text based on bar fill status */}
            {blowState.intensity >= BAR_FILL_THRESHOLD && blowState.isSustained ? (
              <Text style={styles.feedbackText}>
                🎈 Bubble Growing! Keep blowing!
              </Text>
            ) : blowState.intensity >= BAR_FILL_THRESHOLD ? (
              <Text style={styles.feedbackText}>
                ⏳ Bar filled! Keep blowing to grow bubble...
              </Text>
            ) : (
              <Text style={styles.feedbackText}>
                💨 Blow harder to fill the bar! ({(blowState.intensity * 100).toFixed(0)}% / {(BAR_FILL_THRESHOLD * 100).toFixed(0)}%)
              </Text>
            )}
            {/* Debug Info - Show coordinates and values */}
            <View style={styles.debugContainer}>
              <Text style={styles.debugText}>
                Ratio: {ratio ? ratio.toFixed(4) : 'N/A'}
              </Text>
              <Text style={styles.debugText}>
                Protrusion: {protrusion ? protrusion.toFixed(3) : 'N/A'}
              </Text>
              <Text style={styles.debugText}>
                IsOpen: {isOpen ? 'Yes' : 'No'}
              </Text>
              <Text style={styles.debugText}>
                Intensity: {(blowState.intensity * 100).toFixed(1)}%
              </Text>
              <Text style={styles.debugText}>
                IsBlowing: {blowState.isBlowing ? 'Yes' : 'No'}
              </Text>
              <Text style={styles.debugText}>
                Cheek Expansion: {(((cheekExpansion as number) || 0) * 100).toFixed(1)}%
              </Text>
              <Text style={[styles.debugText, { color: blowState.intensity >= BAR_FILL_THRESHOLD ? '#4ADE80' : '#EF4444' }]}>
                Bar Filled: {blowState.intensity >= BAR_FILL_THRESHOLD ? 'Yes ✓' : 'No ✗'}
              </Text>
            </View>
          </View>
        )}

        {/* Calibration */}
        {gameState === 'calibration' && (
          <View style={styles.calibrationContainer}>
            <View style={styles.calibrationBox}>
              <Ionicons name="camera" size={48} color="#FFF" />
              <Text style={styles.calibrationText}>
                {isDetecting ? 'Face detected! Starting soon...' : 'Show your face to the camera'}
              </Text>
            </View>
          </View>
        )}

        {/* Countdown */}
        {gameState === 'countdown' && (
          <View style={styles.countdownContainer}>
            <Animated.Text
              style={[
                styles.countdownText,
                {
                  transform: [{ scale: countdown > 0 ? 1.5 : 1 }],
                },
              ]}
            >
              {countdown > 0 ? countdown : 'GO!'}
            </Animated.Text>
          </View>
        )}

        {/* Game */}
        {gameState === 'playing' && (
          <View style={styles.gameContainer}>
            <View style={styles.bubbleContainer}>
              <Animated.View
                style={{
                  opacity: bubbleOpacity,
                  transform: [{ scale: bubbleSizeAnim.interpolate({
                    inputRange: [0, MAX_BUBBLE_SIZE],
                    outputRange: [0, 1],
                  }) }],
                }}
              >
                <Svg width={MAX_BUBBLE_SIZE} height={MAX_BUBBLE_SIZE}>
                  <Defs>
                    <RadialGradient id="bubbleGradient" cx="50%" cy="30%" r="50%">
                      <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
                      <Stop offset="100%" stopColor="#E0F6FF" stopOpacity="0.6" />
                    </RadialGradient>
                  </Defs>
                  <Circle
                    cx={MAX_BUBBLE_SIZE / 2}
                    cy={MAX_BUBBLE_SIZE / 2}
                    r={bubbleSize / 2}
                    fill="url(#bubbleGradient)"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                </Svg>
              </Animated.View>
            </View>
            <Text style={styles.instructionText}>
              {bubblePopped ? 'Pop!' : 'Blow to make the bubble grow!'}
            </Text>
          </View>
        )}

        {/* Round Success Animation */}
        <RoundSuccessAnimation
          visible={showRoundSuccess}
          stars={roundResults[roundResults.length - 1]?.stars}
        />

        {/* Round Complete - Keep for UI state but animation is shown above */}
        {gameState === 'roundComplete' && !showRoundSuccess && (
          <View style={styles.roundCompleteContainer}>
            <Text style={styles.roundCompleteText}>
              Round {currentRound} Complete!
            </Text>
            <View style={styles.starsDisplay}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={40}
                  color={i < roundResults[roundResults.length - 1]?.stars ? '#FFD700' : '#CCC'}
                />
              ))}
            </View>
          </View>
        )}

        {/* Error */}
        {jawError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{jawError}</Text>
          </View>
        )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  playArea: {
    flex: 1,
    position: 'relative',
  },
  fullScreenCamera: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: '#000000',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    pointerEvents: 'box-none', // Allow touches to pass through to camera
    overflow: 'visible', // Ensure children can render outside bounds
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 8,
  },
  backButton: {
    padding: 8,
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
  },
  roundText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  feedbackText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    textAlign: 'center',
    marginTop: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  meterContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  debugContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
    alignItems: 'center',
  },
  debugText: {
    fontSize: 14,
    color: '#FFF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginVertical: 2,
  },
  calibrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calibrationBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 32,
    borderRadius: 20,
    alignItems: 'center',
  },
  calibrationText: {
    fontSize: 18,
    color: '#FFF',
    marginTop: 16,
    textAlign: 'center',
  },
  countdownContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 120,
    fontWeight: '900',
    color: '#FFF',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  gameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bubbleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginTop: 32,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  roundCompleteContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundCompleteText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 24,
  },
  starsDisplay: {
    flexDirection: 'row',
    gap: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
  },
  cameraLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  cameraLoadingText: {
    fontSize: 18,
    color: '#FFF',
    fontWeight: '600',
  },
  landmarkDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00FF00',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    zIndex: 20,
    shadowColor: '#00FF00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  landmarkKey: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF00FF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    zIndex: 21,
    shadowColor: '#FF00FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 6,
  },
  landmarkUpper: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00FFFF',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    zIndex: 20,
    shadowColor: '#00FFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 5,
  },
  landmarkLower: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFF00',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    zIndex: 20,
    shadowColor: '#FFFF00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 5,
  },
  landmarkTestIndicator: {
    position: 'absolute',
    top: 100,
    right: 20,
    backgroundColor: 'rgba(255, 0, 0, 0.8)',
    padding: 8,
    borderRadius: 8,
    zIndex: 100,
  },
  landmarkTestText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  landmarkTestDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FF0000',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    zIndex: 9999,
    shadowColor: '#FF0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 15,
    elevation: 20,
  },
});

