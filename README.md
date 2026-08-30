# IoT Smart Parking System 🅿️

An asynchronous, event-driven smart parking system built on ESP32 hardware, with real-time cloud-synced slot occupancy.

![Dashboard Screenshot](ضيف رابط سكرين شوت هون)

## Overview

This project detects parking slot occupancy in real time using a 7-sensor infrared matrix, and pushes live updates to a web dashboard over MQTT. It includes event-driven anti-tailgating logic with sub-1ms gate closure.

## Hardware

- **Microcontroller:** ESP32 DevKit v1
- **Sensing:** 7-sensor infrared (IR) matrix
- **Signal Conditioning:** LM393 voltage comparator circuits
- **Actuation:** PWM-controlled servo motors, with a power-isolated servo shield
- **Connectivity:** MQTT

## Key Engineering Challenge: Brownout Loop

Driving multiple servo motors from the same power rail as the ESP32 caused inductive load inrush current on activation, triggering repeated brownout resets. This was solved through **power domain separation** — isolating the servo power supply from the ESP32's logic power domain — which eliminated the brownout loop entirely.

## Features

- Real-time slot occupancy synced to a live dashboard
- Event-driven anti-tailgating logic (sub-1ms gate closure)
- MQTT-based sensor-to-dashboard communication — cut simulated search time by 60%

## Live Dashboard

🔗 [View Dashboard](https://khader79.github.io/ISPS_WEB/index.html)

## Author

Khader Qaabar — Computer Engineering student, Al-Quds University
