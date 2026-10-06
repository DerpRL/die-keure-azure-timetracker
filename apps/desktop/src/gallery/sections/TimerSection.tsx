import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/Segmented';
import { TimerDisplay } from '../../timer/TimerDisplay';
import type { TrackingStatus } from '../../timer/status';
import { GallerySection, Grid, Row, Specimen } from '../GalleryLayout';

const TARGET = 7 * 3600 + 36 * 60;

function LiveTimer() {
  const [status, setStatus] = useState<TrackingStatus>('running');
  const [session, setSession] = useState(1);
  const [seconds, setSeconds] = useState(3595);
  useEffect(() => {
    if (status !== 'running') return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [status]);
  return (
    <div className="gallery-stack">
      <TimerDisplay
        seconds={seconds}
        status={status}
        sessionId={`live-${session}`}
        todaySeconds={4.2 * 3600 + seconds}
        dailyTargetSeconds={TARGET}
        size="large"
      />
      <SegmentedControl
        label="State"
        size="small"
        selectedKey={status}
        onSelectionChange={setStatus}
        options={[
          { id: 'running', label: 'Running' },
          { id: 'paused', label: 'Paused' },
          { id: 'disconnected', label: 'Unconfirmed' },
        ]}
      />
      <Row>
        <Button
          size="small"
          onPress={() => {
            setSession((value) => value + 1);
            setSeconds(0);
          }}
        >
          New session
        </Button>
        <Button size="small" onPress={() => setSeconds((value) => value + 3600 * 99)}>
          Jump past 100 hours
        </Button>
      </Row>
    </div>
  );
}

export function TimerSection() {
  return (
    <GallerySection
      id="timer"
      title="Timer"
      description="Rolling digits never shift the layout; only confirmed running time rolls. The ring is capped at one circle; screen readers get one labelled value."
    >
      <Grid>
        <Specimen title="Live (watch the digits roll)">
          <LiveTimer />
        </Specimen>
        <Specimen title="States">
          <div className="gallery-stack">
            <TimerDisplay seconds={4521} status="running" sessionId="a" todaySeconds={3.4 * 3600} dailyTargetSeconds={TARGET} />
            <TimerDisplay seconds={1830} status="paused" sessionId="b" todaySeconds={6 * 3600} dailyTargetSeconds={TARGET} />
            <TimerDisplay seconds={0} status="stopped" sessionId="c" todaySeconds={2 * 3600} dailyTargetSeconds={TARGET} />
            <TimerDisplay seconds={7322} status="disconnected" sessionId="d" todaySeconds={5 * 3600} dailyTargetSeconds={TARGET} totalsConfirmed={false} />
            <TimerDisplay seconds={7322} status="attention" sessionId="e" todaySeconds={5 * 3600} dailyTargetSeconds={TARGET} />
            <TimerDisplay seconds={0} status="connecting" sessionId="f" todaySeconds={null} dailyTargetSeconds={TARGET} />
          </div>
        </Specimen>
        <Specimen title="Ring">
          <div className="gallery-stack">
            <TimerDisplay seconds={36000} status="running" sessionId="g" todaySeconds={11 * 3600} dailyTargetSeconds={TARGET} detail="Capped: 11h of 7h 36m" />
            <TimerDisplay seconds={600} status="running" sessionId="h" todaySeconds={600} dailyTargetSeconds={0} />
            <TimerDisplay seconds={600} status="running" sessionId="i" todaySeconds={null} dailyTargetSeconds={TARGET} />
          </div>
        </Specimen>
        <Specimen title="Sizes">
          <div className="gallery-stack">
            <TimerDisplay seconds={4521} status="running" sessionId="s" size="small" showRing={false} />
            <TimerDisplay seconds={4521} status="running" sessionId="m" todaySeconds={3600} dailyTargetSeconds={TARGET} />
            <TimerDisplay seconds={4521} status="running" sessionId="l" todaySeconds={3600} dailyTargetSeconds={TARGET} size="large" />
          </div>
        </Specimen>
      </Grid>
    </GallerySection>
  );
}
