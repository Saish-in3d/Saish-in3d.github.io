---
layout: post
title: "Unreal Engine GPU Stack: Chapter 2 Scene View Extensions"
description: "How to inject a custom rendering pass into Unreal's frame without modifying the engine"
tags: [unrealengine, gamedev, gpu, graphics]
cover_image: https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/zeu09krgpk0zl2jhrz73.png
---

_How to inject a custom rendering pass into Unreal's frame without modifying the engine._

In Chapter 1 we did all the required world building... three threads, the RHI, and the Render Dependency Graph. The next practical question is how your own GPU work gets _into_ Unreal's frame.

There are a few common answers from Youtube tutorials, and none of them are perfect. A post-process material can't run a compute shader or write to an render target. A Scene Capture Component renders the whole scene again from another view just to hand you pixels you already had. 

Imagine overlying your active digital twin data over real world CCTV footage. Or building a cam overlay over Unreal Automotive HMD or just compositing real world background to generate synthetic data. All can be done efficiently using GPUCompositionGraphicsPipeline or SynthPass. More about this in this chapter.

## 1. What's happening in GPUCompositionGraphicsPipeline
This chapter uses one plugin as its running example: `GPUCompositionGraphicsPipeline`. It takes a live video feed (anything that plays into a `UMediaTexture`) and composites the rendered frame over it. All of it runs on the GPU, in the middle of Unreal's own post-processing.

It has three parts:

- **`UCompGraphicsSubsystem`**, an engine subsystem that runs on the Game thread. This is the Blueprints facing side. It creates and owns the extension, holds the media texture and the output render target, and tags the actors that should appear in the composite with custom stencil value `20`.
- **`FCoreSVE`**, the Scene View Extension. It subscribes to the post-processing stage right after FXAA and runs the compositing callback on the Render thread.
- **Two passes inside that callback.** A pixel shader (`FCustomDepthStencilMaskCreatorPS`) turns the custom stencil buffer into a mask. Then a compute shader (`FCompositorCS`) blends scene color, the mask and the media texture. The result is drawn to the viewport and copied into a render target, so it can be used outside the viewport too.

So in one frame, the Game thread only sets values. On the Render thread, the renderer asks `FCoreSVE` where it wants to run. After FXAA it adds the mask pass, then the compositing pass, then the copy and draw. Every snippet below is from this plugin unless it's marked as engine source.

Engine code below is from UE 5.6

The interface lives in the `Engine` module (`Engine/Public/SceneViewExtension.h`), but anything useful you do inside it needs the rendering modules. The plugin's `Build.cs`:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/GPUCompositionGraphicsPipeline.Build.cs#L12-L21"></div>

The headers you'll typically include:

![Scene View Extension headers](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/of52rlc4t9zbmxej8lob.png)

One header to be careful with: `FPostProcessingInputs`, the argument to `PrePostProcessPass_RenderThread`, is defined in `Renderer/Internal/PostProcess/PostProcessInputs.h`. You can override the hook with only a forward declaration. But if you want to read its members, you have to add `Renderer/Internal` to your include paths, and nothing in `Internal` or `Private` is a stable API. Stay in `Public` wherever you can.

The plugin does take that trade-off. It includes `PostProcess/PostProcessInputs.h` and a few other renderer headers, so it adds both paths. It builds on 5.6, but an engine upgrade can break it:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/GPUCompositionGraphicsPipeline.Build.cs#L36-L45"></div>

**The shaders have to be found before they compile.** If the extension uses global shaders from your plugin, the `Shaders` directory mapping from Chapter 1 must exist before the engine compiles global shaders, which happens early in startup. Thus, such modules use `"LoadingPhase": "PostConfigInit"` in the `.uplugin`. With `Default`, the engine can't resolve your virtual shader path. The plugin's [`.uplugin`](https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/GPUCompositionGraphicsPipeline.uplugin#L21) sets `PostConfigInit`, and `StartupModule` does only the mapping:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Private/GPUCompositionGraphicsPipeline.cpp#L7-L12"></div>

There was a second problem I didn't expect here: mapping the shader directory and creating the extension can't happen at the same point in startup.

```cpp
// Engine source: Engine/Private/SceneViewExtension.cpp
void FSceneViewExtensions::RegisterExtension(const FSceneViewExtensionRef& RegisterMe)
{
    if (ensure(GEngine))
    {
        auto& KnownExtensions = GEngine->ViewExtensions->KnownExtensions;
        // ... compact dead entries ...
        KnownExtensions.AddUnique(RegisterMe);
    }
}
```

A module loading at `PostConfigInit` starts long before `GEngine` exists. So map the shader directory in `StartupModule`, but create the extension later... in a subsystem's `Initialize`, from `FCoreDelegates::OnPostEngineInit`, or when gameplay asks for it. The plugin uses the last option: nothing is created until a Blueprint calls `InitilizeCompositor` on the subsystem.

## 2. Creating and owning an extension
The plugin's extension, trimmed to what it uses:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Public/CoreGraphicsPipeline.h#L10-L29"></div>
<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Private/CoreGraphicsPipeline.cpp#L27-L31"></div>

`FAfterPassCallbackDelegateArray` is the older name. In 5.6 it's an alias for `FPostProcessingPassDelegateArray`, so both compile.

And creating it, from the subsystem:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Public/CompGraphicsSubsystem.h#L87"></div>
<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Private/CompGraphicsSubsystem.cpp#L26-L34"></div>

`FAutoRegister` has a private constructor, and only `FSceneViewExtensions` can create one. So `new FCoreSVE(...)` doesn't compile. The only way in is `NewExtension<T>()`, which constructs the extension, wraps it in a thread-safe shared pointer, and registers it in one step. The first constructor argument must be `FAutoRegister`. Any extra arguments you pass to `NewExtension` are forwarded after it.

**Ownership is yours.** The engine's registry only holds *weak* pointers. If you drop your shared pointer, the extension is gone from the next frame on, and that's also how you unregister it:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Private/CompGraphicsSubsystem.cpp#L77-L95"></div>

The frame already in flight is safe (the frame that is being rendered in gpu). Each view family copies the active extensions into `ViewFamily.ViewExtensions` as *strong* references, so the Render thread keeps the extension alive until that frame finishes. This is the same idea as the scene proxies in Chapter 1: the Game thread can let go while the Render thread finishes using it.

`ESPMode::ThreadSafe` isn't optional. The pointer is created on the Game thread and used on the Render thread, so its reference count must be atomic.

Who should hold the pointer? Something that lives as long as the effect should: an engine subsystem for effects that persist across levels, a world subsystem for per-level effects, or an actor or component when the effect belongs to one object. The plugin uses an engine subsystem, so the compositor survives level changes.


## 3. Every injection point in the frame
The hooks follow the frame from Game-thread setup to the end of rendering. Let's see which thread calls them.

![Where a Scene View Extension runs in one frame](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/8cljusi7pyelnu02vp27.png)

### 3.1 Game thread hooks: shaping the MVP
These hooks run while the engine builds the view family for the _next_ frame. They don't take an `FRDGBuilder`, so you can't add passes here. Their job is to change _what_ gets rendered, not _how_.

![Game thread hooks](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/is8qkpibsvqlrpcse53p.png)

Let's take a closer look at `BeginRenderViewFamily` . It's the last point where you're on the Game thread and know that a frame is about to be rendered. It's the correct place to copy settings, `UObject` data and texture resource pointers into a plain struct that the Render-thread hooks will read. Reading `UObject`s directly from Render-thread hooks is the kind of data race Chapter 1 warned about. It usually works, until the Game thread changes the object in the middle of a frame. You also need to consider the copy cost for data from one thread to another. It a tradeoff between performance and unsafe code (Just like rust providing memory safety at compile times but programmers need to write unsafe() code at some places to extract every drop of perf)

### 3.2 Render thread: the scene renderer
These hooks receive an `FRDGBuilder&`. As Chapter 1 explained, nothing runs when you call RDG. You're adding passes to a graph that executes later, and the graph orders them after whatever came before your hook.

![Render thread hooks](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/djkpqs6g4fpkp7myvfgz.png)

You can see that the per-view hooks (`PreRenderView`, `PrePostProcessPass`, `PostRenderView`) run once for _each_ view. Split screen, stereo rendering and scene captures with multiple views all call them more than once per frame, so don't assume one call means one frame.

## 4. Injection points inside post-processing
`SubscribeToPostProcessingPass` works differently from the other hooks. It doesn't render anything. At the start of post-processing, the renderer calls it once per view for each stage and asks "do you want to run something here?". You answer by adding a delegate. The plugin answers only for the FXAA stage, and only while the compositor is running:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Private/CoreGraphicsPipeline.cpp#L39-L51"></div>

This hook runs on the Render thread, and it reads a `UObject` (the subsystem) directly. That's the race described above. It works because a bool flag is rarely changed mid-frame. The safer version copies the flag in `BeginRenderViewFamily`.

These are the stages in 5.6, in the order they run in the frame. The engine header notes that each one sits immediately before a post-process material blendable location, so if you know the material blend locations, you already know these:

![Post-processing injection stages](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/hilcgbieshf3ovbmzr17.png)

The plugin's stage, FXAA, comes after tonemapping. So the composite blends display-ready colors with the video, which is the space the footage is already in. Here's the FXAA case from `PostProcessing.cpp`, because it surprises people:

```cpp
// Engine source: Renderer/Private/PostProcess/PostProcessing.cpp
if (PassSequence.IsEnabled(EPass::FXAA))
{
    SceneColor = AddFXAAPass(GraphBuilder, View, PassInputs);
}
SceneColor = AddAfterPass(EPass::FXAA, SceneColor);   // your callbacks, unconditionally
```

That's the reason why the plugin's callback still runs when the project uses TSR and FXAA is off. The `bIsPassEnabled` argument tells you whether the pass itself is running this frame. In the engine's recommendation, subscribe only when you'll actually produce a GPU resource.

### 4.1 The contract for a post-processing callback
Every stage uses the same delegate signature. The plugin's callback:

<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Public/CoreGraphicsPipeline.h#L24"></div>
<div class="gh-embed" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Private/CoreGraphicsPipeline.cpp#L53-L113"></div>

Three rules to keep in mind while setting a callback:

1. **You receive scene color and must return scene color.** 
2. Multiple subscribers to the same stage run in priority order, and each one gets the previous one's output.
3. **`OverrideOutput` is only valid if you're last.** For the later stages (from `ReplacingTonemapper` onwards), your callback may be the final pass that writes to the back buffer. In that case `Inputs.OverrideOutput` is valid and you **must** write into it. Otherwise it's invalid and you create your own output (Creates a black screen on viewport).


`GraphicsCompositing` adds the mask pass and then hands off to `FCompositorCS::ImplementCompShader`, which handles the output. Trimmed to the parts that follow the contract:

```cpp
// CompositorCS.cpp
FScreenPassTexture FCompositorCS::ImplementCompShader(FRDGBuilder& GraphBuilder, const FSceneView& SceneView,
    const FPostProcessMaterialInputs& Inputs, /* ...mask, media texture, blend values... */)
{
    // Rule 1: take scene color in
    const FScreenPassTexture& SceneColor = FScreenPassTexture::CopyFromSlice(
        GraphBuilder, Inputs.GetInput(EPostProcessMaterialInput::SceneColor));

    // Rule 3: write into OverrideOutput if we're last, otherwise make our own target
    FScreenPassRenderTarget Output = Inputs.OverrideOutput;
    if (!Output.IsValid())
    {
        Output = FScreenPassRenderTarget::CreateFromInput(
            GraphBuilder, SceneColor, ERenderTargetLoadAction::ENoAction, TEXT("CompositorViewportOutput"));
    }

    // Compositing compute pass writes OutputTexture, then it's copied into the output render target.
    // (Chapter 3 covers writing the shader and adding the pass.)

    AddDrawTexturePass(GraphBuilder, SceneView, FScreenPassTexture(OutputTexture), Output);

    // Rule 1: hand scene color back
    if (bShallCompOutputOnViewport)
    {
        return FScreenPassTexture(Output);
    }
    return SceneColor;
}
```

<div class="gh-embed" data-max-height="420" data-target="https://github.com/Saish-in3d/SynthPass/blob/a45151350991c5cbf54857dbea87fc5f7d6c4e4b/Source/GPUCompositionGraphicsPipeline/Private/CompositorCS.cpp#L14-L140"></div>




## 5. What's next
This chapter covered where your work can go in the frame. It skipped _what_ that work is: the shader, its parameter struct, and how a pass is added to the graph. Chapter 3 covers that with compute shaders: declaring a global shader in a plugin, binding its parameters, dispatching it through RDG from one of the hooks above, and what happens between `FComputeShaderUtils::AddPass` and threads running on an SM.
