// Native macOS transport for Inventory P-touch raster jobs.
// Build: clang -fobjc-arc -fblocks -framework Foundation -framework IOBluetooth
//        macos_ptouch_bluetooth.m -o inventory-ptouch-bluetooth
// Uses Apple's public IOBluetooth API and Brother's Raster Command Reference 1.02.
// A failed/ambiguous transfer is NEVER retried; the caller retains its receipt.
#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#include <unistd.h>
@interface Receiver : NSObject <IOBluetoothRFCOMMChannelDelegate>
@property BOOL opened;
@property IOReturn openResult;
@property BOOL closed;
@property BOOL wrote;
@property IOReturn writeResult;
@property(strong) NSMutableData *received;
@end
@implementation Receiver
- (void)rfcommChannelOpenComplete:(IOBluetoothRFCOMMChannel *)c status:(IOReturn)s { self.openResult=s; self.opened=YES; }
- (void)rfcommChannelClosed:(IOBluetoothRFCOMMChannel *)c { self.closed=YES; }
- (void)rfcommChannelData:(IOBluetoothRFCOMMChannel *)c data:(void *)p length:(size_t)n { if (self.received.length+n>65536) { self.closed=YES; [c closeChannel]; return; } [self.received appendBytes:p length:n]; }
- (void)rfcommChannelWriteComplete:(IOBluetoothRFCOMMChannel *)c refcon:(void *)r status:(IOReturn)s { self.writeResult=s; self.wrote=YES; }
@end
static BOOL waitFor(double seconds, BOOL (^ready)(void)) {
 NSDate *until=[NSDate dateWithTimeIntervalSinceNow:seconds];
 while (!ready() && [until timeIntervalSinceNow]>0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
 return ready();
}
static BOOL sendBytes(IOBluetoothRFCOMMChannel *c, Receiver *r, NSData *data) {
 NSUInteger mtu=MIN((NSUInteger)[c getMTU],512); if(!mtu) return NO;
 for(NSUInteger offset=0;offset<data.length;offset+=mtu){
  NSUInteger n=MIN(mtu,data.length-offset); void *bytes=malloc(n); memcpy(bytes,(const char*)data.bytes+offset,n);
  r.wrote=NO;
  IOReturn code=[c writeAsync:bytes length:(UInt16)n refcon:bytes];
  if(code){free(bytes);fprintf(stderr,"Write rejected: %x\n",code);return NO;}
  if(!waitFor(8,^BOOL{return r.wrote || r.closed;}) || !r.wrote){fprintf(stderr,"Write outcome uncertain; no automatic retry\n");return NO;}
  free(bytes); if(r.writeResult || r.closed) return NO;
 }
 return YES;
}
static NSData *packet(Receiver *r,double timeout){
 __block NSData *result=nil;
 waitFor(timeout,^BOOL{
  while(r.received.length>=32){
   const unsigned char *b=r.received.bytes;
   if(b[0]!=0x80 || b[1]!=0x20 || b[2]!=0x42){[r.received replaceBytesInRange:NSMakeRange(0,1) withBytes:NULL length:0];continue;}
   result=[r.received subdataWithRange:NSMakeRange(0,32)];[r.received replaceBytesInRange:NSMakeRange(0,32) withBytes:NULL length:0]; return YES;
  }
  return r.closed;
 });
 return result;
}

// Validate the complete bounded raster grammar before touching the printer.
static NSUInteger validateJob(NSData *job, unsigned char *tape) {
 if (job.length<135 || job.length>4000000) return 0;
 const unsigned char *b=job.bytes;
 for(NSUInteger i=0;i<100;i++) if(b[i]) return 0;
 if(b[100]!=0x1b || b[101]!=0x40) return 0;
 NSUInteger offset=102,pages=0;
 while(offset+33<=job.length && pages<100){
  const unsigned char *p=b+offset;
  // Match against the encoder's 32-byte header, excluding variable fields.
  const unsigned char expected[]={0x1b,0x69,0x61,1,0x1b,0x69,0x7a,0x86,1,0,0,0,0,0,0,0,0,0x1b,0x69,0x4d,0x40,0x1b,0x69,0x4b,0x48,0x1b,0x69,0x64,28,0,0x4d,2};
  for(NSUInteger k=0;k<32;k++){
   if(k==9 || (k>=11 && k<=15) || k==24) continue;
   if(p[k]!=expected[k])return 0;
  }
  unsigned char width=p[9];
  if(!(width==4||width==6||width==9||width==12||width==18||width==24))return 0;
  if(pages && width!=*tape)return 0;
  *tape=width;
  if(p[15]!=(pages?1:0) || (p[24]!=0x48 && p[24]!=0x40))return 0;
  NSUInteger lines=(NSUInteger)p[11]|((NSUInteger)p[12]<<8)|((NSUInteger)p[13]<<16)|((NSUInteger)p[14]<<24);
  if(lines<4||lines>14116)return 0;
  NSUInteger end=offset+32+20*lines;
  if(end>=job.length)return 0;
  for(NSUInteger row=offset+32;row<end;row+=20)if(b[row]!=0x47||b[row+1]!=17||b[row+2]!=0||b[row+3]!=15)return 0;
  pages++;
  if(b[end]==0x1a)return end+1==job.length && p[24]==0x48 ? pages:0;
  if(b[end]!=0x0c || p[24]!=0x40)return 0;
  offset=end+1;
 }
 return 0;
}

int main(int argc,const char **argv){@autoreleasepool{
 alarm(115); setbuf(stdout,NULL);
 if(argc==3 && !strcmp(argv[1],"--validate")) {
  NSData *job=[NSData dataWithContentsOfFile:@(argv[2])];unsigned char tape=0;
  NSUInteger pages=validateJob(job,&tape);
  printf("pages=%lu tape=%u\n",(unsigned long)pages,tape);return pages?0:1;
 }
 if(argc<3 || (strcmp(argv[2],"status") && strcmp(argv[2],"print")) || (!strcmp(argv[2],"print") && argc!=4)) {fprintf(stderr,"Usage: transport ADDRESS status | print FILE\n");return 64;}
 NSData *printJob=nil; unsigned char requestedTape=0; NSUInteger pages=0;
 if(!strcmp(argv[2],"print")) {printJob=[NSData dataWithContentsOfFile:@(argv[3])];pages=validateJob(printJob,&requestedTape);if(!pages){fprintf(stderr,"Invalid raster job\n");return 1;}}
 IOBluetoothDevice *device=[IOBluetoothDevice deviceWithAddressString:@(argv[1])];
 if(!device || !device.isPaired || ![device.name hasPrefix:@"PT-P710BT"]){fprintf(stderr,"Pair the PT-P710BT in macOS first\n");return 1;}
 printf("Device: %s paired=%d\n",device.name.UTF8String,device.isPaired);
 IOBluetoothSDPUUID *uuid=[IOBluetoothSDPUUID uuid16:0x1101];
 if(![device getServiceRecordForUUID:uuid]){
  IOReturn code=[device performSDPQuery:nil]; printf("SDP request: %x\n",code);
  waitFor(10,^BOOL{return [device getServiceRecordForUUID:uuid]!=nil;});
 }
 IOBluetoothSDPServiceRecord *service=[device getServiceRecordForUUID:uuid];
 BluetoothRFCOMMChannelID channelId=0;
 if(!service || [service getRFCOMMChannelID:&channelId] || !channelId){fprintf(stderr,"No serial Bluetooth service found\n");return 1;}
 printf("SPP channel: %u\n",channelId);
 Receiver *r=[Receiver new];r.received=[NSMutableData data];IOBluetoothRFCOMMChannel *channel=nil;
 IOReturn result=[device openRFCOMMChannelAsync:&channel withChannelID:channelId delegate:r];
 if(result || !waitFor(15,^BOOL{return r.opened;}) || r.openResult){fprintf(stderr,"Connect failed: %x/%x\n",result,r.openResult);[channel closeChannel];return 1;}
 printf("Connected, MTU: %u\n",channel.getMTU);
 unsigned char request[]={0x1b,0x69,0x53};
 if(!sendBytes(channel,r,[NSData dataWithBytes:request length:3])) return 1;
 NSData *status=packet(r,8);
 if(!status){fprintf(stderr,"No printer status received\n");[channel closeChannel];return 1;}
 const unsigned char *s=status.bytes;
 printf("Status: tape=%u mm media=%u errors=%02x/%02x type=%u\n",s[10],s[11],s[8],s[9],s[18]);
 int rc=0;
 if(!strcmp(argv[2],"print")){
  if(argc!=4 || s[8] || s[9]){fprintf(stderr,"Printer not ready\n");rc=1;}
  else{
   NSData *job=printJob;
   if(requestedTape!=s[10]){fprintf(stderr,"Invalid job or tape mismatch\n");rc=1;}
   else {
    [r.received setLength:0];
    if(!sendBytes(channel,r,job)){rc=2;}
    else{
     printf("Sent %lu bytes once; waiting for printer completion\n",(unsigned long)job.length);
     NSUInteger completed=0;NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:90];
     while(completed<pages && [deadline timeIntervalSinceNow]>0){NSData *p=packet(r,MIN(5,[deadline timeIntervalSinceNow]));if(!p){if(r.closed)break;continue;}const unsigned char *b=p.bytes;printf("Printer event: type=%u errors=%02x/%02x\n",b[18],b[8],b[9]);if(b[8]||b[9])break;if(b[18]==1)completed++;}
     if(completed==pages)printf("PRINT_COMPLETED\n");else{fprintf(stderr,"Completion unconfirmed; do not repeat automatically\n");rc=2;}
    }
   }
  }
 } else if(strcmp(argv[2],"status")){rc=64;}
 [channel closeChannel];[channel setDelegate:nil];[device closeConnection];return rc;
}}
