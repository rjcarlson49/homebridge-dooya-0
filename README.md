
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge Platform Plug for Dooya Shade Systems

The plugin was developed specifically to imitate the DC1602 Remote. This remote supports
up to 15 shades with 16 channels. The 0 (zero) channel controls all shades in the group.
Each other channel controls a single shade. There are 3 commands, open, close and stop. 
The Dooya shades are one way communicators, they receive commands, but do not send any
information, not even an acknowledgement.

For each channel the plugin creates an Accessory with 3 services. The main service is
a WindowCovering service which is the Homekit abstraction for a shade. It has three Characteristics, Current Position, Target Position and Position State. The 2 positions
are each integers from 0 to 100 (100 is fully open). The state is Decreasing, Increasing, 
or Stopped. The other two services are switches that are used as simple buttons. One 
is the Open button and the other is the Close button. In Homekit, the WindowCovering 
service is presented as a slider. The switches appears as icons that are tapped to 
change from On to Off or vice versa. In this plugin, these switches are normally Off.
You hit a switch to send an Open code and the switch will light up in the On appearance.
A few seconds later, after the shaade movement is over, the switch will return to Off.

# Hardware Required

The most efficient way to send the remote RF transmissions is to use a separate 
controller. This plugin uses an Arduino programmed specically for this task. The Arduino 
transmitter is connected with the Homebridge system via a simple USB cable. The USB cable 
supplies power to the transmitter and uses USB as a serial connection to the transmitter.
Through the serial connection, the plugin sends commands that open close or stop all shades
or a particular shade.

If the remote being simulated uses similar encoding, but with different timings, the plug-in
can download a configuration string to the transmitter to adapt it to the specific remote
that must be simulated.

<span align="center">

### [Link](https://github.com/homebridge/homebridge-plugin-template/generate)

</span>
