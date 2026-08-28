#include <Arduino.h>
#line 1 "C:\\Users\\khade\\Documents\\Me\\Coding\\Iot Smart Parking System\\web\\server\\uploads\\sketch_94775cbeec2ccf22\\sketch_94775cbeec2ccf22.ino"
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

// القناة اللي موصل عليها السيرفو
#define SERVO_CH 0

// قيم السيرفو
#define SERVO_MIN 150
#define SERVO_MAX 350

#line 13 "C:\\Users\\khade\\Documents\\Me\\Coding\\Iot Smart Parking System\\web\\server\\uploads\\sketch_94775cbeec2ccf22\\sketch_94775cbeec2ccf22.ino"
void setup();
#line 25 "C:\\Users\\khade\\Documents\\Me\\Coding\\Iot Smart Parking System\\web\\server\\uploads\\sketch_94775cbeec2ccf22\\sketch_94775cbeec2ccf22.ino"
void loop();
#line 13 "C:\\Users\\khade\\Documents\\Me\\Coding\\Iot Smart Parking System\\web\\server\\uploads\\sketch_94775cbeec2ccf22\\sketch_94775cbeec2ccf22.ino"
void setup() {
  Serial.begin(115200);

  // SDA = 21 , SCL = 22 للـ ESP32
  Wire.begin(21, 22);

  pwm.begin();
  pwm.setPWMFreq(50); // تردد السيرفو

  Serial.println("Servo Test Start");
}

void loop() {

  // فتح
  Serial.println("OPEN");
  pwm.setPWM(SERVO_CH, 0, SERVO_MAX);
  delay(2000);

  // إغلاق
  Serial.println("CLOSE");
  pwm.setPWM(SERVO_CH, 0, SERVO_MIN);
  delay(2000);
}
