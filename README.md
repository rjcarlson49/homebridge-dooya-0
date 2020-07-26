
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

# Homebridge Plugin for Dooya Shade Systems

This plugin was developed specifically to imitate the Dooya DC1602 Remote. This remote supports
up to 15 shades with 16 channels. The 0 (zero) channel controls all shades in the group.
Each other channel controls a single shade. There are 3 commands, open, close and stop. 
The Dooya shades are one way communicators, they receive commands, but do not send any
information, not even an acknowledgement.

For each channel the plugin creates an Accessory with 3 services. The main service is
a WindowCovering service, the Homekit abstraction for a shade. It has three Characteristics, Current Position, Target Position and Position State. The 2 positions
are each integers from 0 to 100 (100 is fully open). The state is Decreasing, Increasing, 
or Stopped. The other two services are switches that are used as simple buttons. One 
is the Open button and the other is the Close button. In Homekit, the WindowCovering 
service is presented as a slider. The switches appears as icons that are tapped to 
change from On to Off or vice versa. In this plugin, these switches are normally Off.
You hit a switch to send an Open code and the switch will light up in the On appearance.
A few seconds later, after the shade movement is over, the switch will return to Off.

## Hardware Required

The most efficient way to send the remote RF transmissions is to use a separate 
controller. This plugin uses an Arduino programmed specically for this task. The Arduino 
transmitter is connected with the Homebridge system via a USB cable. The cable 
supplies power to the transmitter and uses USB as a serial connection to the transmitter.
Through the serial connection, the plugin sends commands that open close or stop all shades
or a particular shade.

If the remote being simulated uses similar encoding, but with different timings, the plug-in
can download a configuration string to the transmitter to adapt it to the specific remote
that must be simulated.

### [Arduino 433 MHx Transmitter](https://github.com/rjcarlson49/Xmit_433.0)

## Installation

Install from NPM here: [npm homebridge-dooya-0 ](https://www.npmjs.com/package/homebridge-dooya-0)

It is also strongly recommended that you install [homebridge-config-ui-x](https://www.npmjs.com/package/homebridge-config-ui-x). This will give you a much easier way to control your Homebridge server, but also provide easy ways to configure this plugin. 

## Configuration

Select Plugins/Dooya Shade Controller/Settings on the UI. This will take you to a form based conguration for the plugin. From the top level, you can also select Config and you can then edit the raw config file. After you have created a basic configuration using the form, raw editing will be a lot easier.

``` json
    {
        "platform": "DooyaController",
        "name": "Dooya Shades",
        "serialPort": "/dev/cu.usbmodem14301",
        "fixedCode": "B5C7FFB",
        "openCode": "EE*5 E1*5",
        "closeCode": "CC*5 C3*5",
        "stopCode": "AA*4",
        "shades": [
            {
                "enabled": false,
                "displayName": "Shade Zero",
                "channelNum": 0,
                "groupCode": true,
                "channelCode": "F",
                "maxTime": 32.5
            },
            {
                "enabled": true,
                "displayName": "Shade One",
                "channelNum": 1,
                "groupCode": false,
                "channelCode": "E",
                "maxTime": 33
            },
            {
                "enabled": false,
                "displayName": "Shade Two",
                "channelNum": 2,
                "groupCode": false,
                "channelCode": "D",
                "maxTime": 33
            }
        ],
        "debounce": 500,
        "xmitWait": 2000,
        "updateWait": 50,
        "enableTransmitterConfig": false,
        "zeroOn": 700,
        "zeroOff": 340,
        "oneOn": 340,
        "oneOff": 700,
        "startOfRowOn": 4650,
        "startOfRowOff": 1480,
        "endOfRowOff": 9000,
        "endOfMsgOff": 6000,
        "dataPin": 12,
        "debugFlags": 6,
    }
```

## Platform

Name | Description
---------------|:-------------------------|
Name|Your name for the plugin.
Serial Port | The port name of the USB port to which your Arduino transmitter is connected.

## Remote Commands

Each command is 10 hex digits or 40 bits, consisting of a fixed part, a channel code and a command code. The plugin does not care how long each of these is, but in the DC1602, the fixed part is 7 hex digits, the channel code is 1 hex digit and the command is 2 hex digits.

Name | Description
---------------|:-------------------------|
Fixed Code | Fixed part, in hex. Usually 7 digits.
Open Code | Hex code for 'Open'. It can be followed by '*' and a decimal digit indicating number of times to transmit this row. Mutliple entries are allowed because some operations like open required more than one 40 bit row to be sent.
Close Code | Hex code for 'Close'. It can be followed by '*' and a decimal digit indicating number of times to transmit this row. Mutliple entries are allowed because some operations like open required more than one 40 bit row to be sent.
Stop Code | Hex code for 'Stop'. It can be followed by '*' and a decimal digit indicating number of times to transmit this row. Mutliple entries are allowed because some operations like open required more than one 40 bit row to be sent.

## Shades/Channels

Name | Description
---------------|:-------------------------|
Enabled | Enable/Disable - When disabled, individual shades don't operate. The groupCode will be treated differently. When disabled, all group commands will be forwarded to individual shades.
Channel 0 - All shades | Channel 0 is likely to be a channel received by all shades. Check the groupCode box for the channel that controls all shades.
displayName | The name you call the shade in Homekit/Siri. Give it a name you can pronounce for Siri.
ChannelNum | For convenience, it should be 1 digit, the same as the number on your remote for the this shade/channel.
ChannelCode | This is (usually) 1 hex digit channel code sent in a command to this shade/channel.
maxTime | The time in seconds that it takes this shade to go from fully open to fully closed or vice versa. Decimal fractions are allowed. The plugin uses this time to estimate when operations are complete. Time your shades a couple of times.

## Transmitter Config

The plugin cannot know when a shade operation is complete, so it relies on keeping time. There are also things in the system that must be spaced out. These timing settings help make everything work smootly.

Name | Description
---------------|:-------------------------|
debounce | Homekit will often send multiple commands to the plugin, for example while a slider is being adjusted. The plugin will wait this number of ms before executing a command in case another superceding command arrives. The default of 500 (.5 s) works well.
xmitWait | The code sets this as a timeout when it transmits remote codes. The arduino code responds with !!READY!! when it is ready for another tranmission, but in case this is missed, the timeout will recover. 2000 ms is the default (2 s).
updateWait | The plugin sends many updates to Homekit during an operation. It will wait this number of ms between updates to avoid overwhelming the channel. 50 ms is the default.

## Debug Flags

A set of bit flags that control the verbocity of output. Enter a decimal number that is the sum of the flags.

Name | Description
---------------|-------------------------|
+1 | Requests for slots to update Homekit.
+2 | Requests for transmission of command codes via the Arduino.
+4 | Show the text sent back by the Arduino transmitter.
+8 | Other - all other debug output.

## Decoding Your Remote

You will need to decode your remote in order to fill in many of the configuration options above, though it is possible the defaults will work.

It is pretty certain that your remote does not use the same coding that mine does. To decode yours you need a software defined radio and a decoding program. I used the program [rtl_433](https://github.com/merbanan/rtl_433). 

A radio is required. I used the [NooElec NESDR](https://amazon.com/gp/product/B01GDN1T4S/ref=ppx_yo_dt_b_asin_title_o09_s00?ie=UTF8&psc=1). It plugs into a USB port.

First try this Flex Decoder spec. Start up rtl_433 with this command and then operate your remote.

    rtl_433 -R 0 -X 'n=Dooya,s=360,l=720,r=14844,g=0,t=0,y=4740'

If it decodes the messages, you will see the rows displayed in hex and binary. Do this for enough of your remote commands for you to figure out the fixed part, the channel codes and the commands.

If the spec above does not work for you, then you need to run an analysis first.

## RTL_433 Analysis

Use the "-A -R 0" options to discover the basic structure of the messages, the on-off timings and rows. After setting up the program and radio, run the program with -A and -R 0, operate the remote and it will spit out the specs for the OOK encoding.

Using that information, use rtl_433 as above to decode the messages from your remote and find the command and channel encodings.

A Flex Decoder can be used either with -R 0 -X '...' or it can be put into the rtl_433.conf file like this 

    decoder 'n=Dooya,s=360,l=720,r=14844,g=0,t=0,y=4740'

