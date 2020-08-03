# Change Log

## V 1.2.0 (202-08-03)

### Updates
Test Mode was added. In test mode the serial port to the Arduino is not opened and commands are not sent to the shades. This allows the plugin to be tested when you do not have the Arduino transmitter or whe you do not want the shades affected.

### Bug Fixes
Fixed a bug in the tickTime update code.

## V 1.1.0 (2020-07-25)

### Updates
The accuracy of timing is an issue. The config entry called tickFudge is removed. Timing accuracy is now ensured by adaptive code. An initial estimate for 'tickTime' is made for the delay required to reach a target time. When the timing is complete, the actual result is compared and the tickTime is updated to improve accuracy.

## V 1.0.0 (2020-07-19)

This is the initial release. It supports a clone of the Dooya DC1602 remote for shades.