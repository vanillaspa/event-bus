## Getting started

To install the event-bus into your project, simply run

```bash
npm install @vanillaspa/event-bus
```

## How-To

Now integrate the event-bus into your app: 

```javascript
<script type="module">
  import * as bus from '@vanillaspa/event-bus';
  window.bus = bus;
</script>
```

This is only a recommendation. You can use it however you like. With the `bus` object attached to the `window` object, you have access to the event-bus in your WebComponents.

Then simply use `bus.addEventListener(type, listener)` and `bus.dispatchEvent(event)` in your WebComponents.

You are not bound to event bubbling or capturing, which are the standard event propagation mechanisms, but now you can send events even among any objects!

```javascript
bus.addEventListener("click", () => {console.log("click")}, window);
bus.dispatchEvent(new Event("click"), window);
```

## EventBus API architecture

![EventBus schema](eventbus.png)

```mermaid
classDiagram
    EventTarget <|-- EventBus
    EventTarget: +addEventListener()
    EventTarget: +removeEventListener()
    EventTarget: +dispatchEvent()
    EventBus: -WeakMap listeners
```

That's it. Check it out! KISS

## Contribute

Please give your warm feedback.