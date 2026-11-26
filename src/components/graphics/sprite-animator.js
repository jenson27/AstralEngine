import { AstralLogger } from "../../diagnostics/logger.js";

export class SpriteAnimator {
    constructor(animationHandle, initialClip = null) {
        this._state = null;
        this.SetAnimationHandle(animationHandle, initialClip);
    }

    SetAnimationHandle(animationHandle, initialClip = null) {
        if (
            !animationHandle ||
            typeof animationHandle.AssetId !== "string"
        ) {
            throw new TypeError(
                "SpriteAnimator requires a sprite animation asset handle.",
            );
        }
        if (
            initialClip !== null &&
            (typeof initialClip !== "string" || initialClip.trim() === "")
        ) {
            throw new TypeError(
                "SpriteAnimator initialClip must be a non-empty string or null.",
            );
        }
        const asset = animationHandle.Current;
        if (!asset || typeof asset.GetClip !== "function") {
            throw new TypeError(
                "SpriteAnimator requires a valid sprite animation asset.",
            );
        }
        if (initialClip !== null && !asset.GetClip(initialClip)) {
            throw new RangeError(
                `Sprite initial clip "${initialClip}" does not exist.`,
            );
        }
        this.AnimationHandle = animationHandle;
        this.InitialClip = initialClip;
        this._state = null;
    }

    get CurrentClipName() {
        return this._state?.clipName ?? this.InitialClip;
    }

    get CurrentFrameIndex() {
        if (this._state) {
            return this._state.frameIndex;
        }

        const asset = this.AnimationHandle.Current;
        const clip =
            asset.GetClip(this.InitialClip ?? asset.DefaultClip) ??
            asset.GetClip(asset.DefaultClip);
        return clip?.steps[0]?.frame ?? 0;
    }

    get LoopCount() {
        return this._state?.loopCount ?? 0;
    }

    Update(deltaTime, eventRecords, dispatch) {
        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
            throw new RangeError(
                "Sprite animation deltaTime must be non-negative.",
            );
        }
        const asset = this.AnimationHandle.Current;
        if (!this._state) {
            this._state = this._CreateState(asset, this.AnimationHandle.Version);
            this._EnterFrame(asset, dispatch, null);
        } else if (this._state.assetVersion !== this.AnimationHandle.Version) {
            this._RefreshAsset(asset, this.AnimationHandle.Version);
        }

        for (const eventRecord of eventRecords) {
            this._ApplyEvent(asset, eventRecord, dispatch);
        }

        if (this._state.isPlaying) {
            this._Advance(asset, deltaTime * 1000, dispatch);
        }
    }

    _CreateState(asset, assetVersion) {
        const clipName = this.InitialClip ?? asset.DefaultClip;
        const clip = asset.GetClip(clipName);
        if (!clip) {
            throw new RangeError(`Sprite initial clip "${clipName}" does not exist.`);
        }
        return {
            assetVersion,
            clipName,
            stepIndex: 0,
            frameIndex: clip.steps[0].frame,
            elapsedMs: 0,
            loopCount: 0,
            isPlaying: true,
        };
    }

    _RefreshAsset(asset, assetVersion) {
        const state = this._state;
        const clip = asset.GetClip(state.clipName);
        state.assetVersion = assetVersion;
        if (!clip) {
            AstralLogger.Warn("Active sprite clip was removed during asset reload; using the default clip.", {
                assetId: this.AnimationHandle.AssetId,
                clipName: state.clipName,
            });
            state.clipName = asset.DefaultClip;
            state.stepIndex = 0;
            state.frameIndex = asset.GetClip(asset.DefaultClip).steps[0].frame;
            state.elapsedMs = 0;
            state.loopCount = 0;
            state.isPlaying = true;
        } else {
            state.stepIndex = Math.min(state.stepIndex, clip.steps.length - 1);
            state.frameIndex = clip.steps[state.stepIndex].frame;
            state.elapsedMs = Math.min(
                state.elapsedMs,
                clip.steps[state.stepIndex].durationMs,
            );
        }
    }

    _ApplyEvent(asset, eventRecord, dispatch) {
        const clipName = asset.GetClipForEvent(eventRecord.eventName);
        if (!clipName) {
            return;
        }
        const nextClip = asset.GetClip(clipName);
        const activeClip = asset.GetClip(this._state.clipName);
        if (clipName === this._state.clipName) {
            if (!nextClip.replayOnEvent) {
                return;
            }
        } else if (nextClip.priority <= activeClip.priority) {
            return;
        }
        this._state.clipName = clipName;
        this._state.stepIndex = 0;
        this._state.frameIndex = nextClip.steps[0].frame;
        this._state.elapsedMs = 0;
        this._state.loopCount = 0;
        this._state.isPlaying = true;
        this._EnterFrame(asset, dispatch, eventRecord);
    }

    _Advance(asset, elapsedMs, dispatch) {
        let remainingMs = elapsedMs;
        while (remainingMs >= 0 && this._state.isPlaying) {
            const clip = asset.GetClip(this._state.clipName);
            const step = clip.steps[this._state.stepIndex];
            const timeToNextFrame = step.durationMs - this._state.elapsedMs;
            if (remainingMs < timeToNextFrame) {
                this._state.elapsedMs += remainingMs;
                return;
            }
            remainingMs -= timeToNextFrame;
            this._state.elapsedMs = 0;
            const nextIndex = this._state.stepIndex + 1;
            if (nextIndex < clip.steps.length) {
                this._state.stepIndex = nextIndex;
            } else if (clip.loop) {
                this._state.stepIndex = 0;
                this._state.loopCount += 1;
            } else if (
                clip.returnToDefault &&
                this._state.clipName !== asset.DefaultClip
            ) {
                this._state.clipName = asset.DefaultClip;
                this._state.stepIndex = 0;
                this._state.loopCount = 0;
            } else {
                this._state.isPlaying = false;
                return;
            }
            this._EnterFrame(asset, dispatch, null);
            if (remainingMs === 0) {
                return;
            }
        }
    }

    _EnterFrame(asset, dispatch, eventRecord) {
        const clip = asset.GetClip(this._state.clipName);
        const step = clip.steps[this._state.stepIndex];
        this._state.frameIndex = step.frame;
        for (const trigger of step.triggers) {
            dispatch({
                action: trigger.action,
                payload: trigger.payload,
                eventName: eventRecord?.eventName ?? null,
                eventPayload: eventRecord?.payload ?? {},
                clipName: clip.name,
                frameIndex: step.frame,
                sequenceIndex: this._state.stepIndex,
                loopCount: this._state.loopCount,
            });
        }
    }
}
