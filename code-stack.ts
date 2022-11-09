import ec2 = require('@aws-cdk/aws-ec2');
import cdk = require('@aws-cdk/core');

import { Fn, Tag, Resource } from '@aws-cdk/core';
import { AmazonLinuxImage, UserData, InstanceType } from '@aws-cdk/aws-ec2';
import { Role, ServicePrincipal, ManagedPolicy, CfnInstanceProfile } from '@aws-cdk/aws-iam'

/**
 * Create my own Ec2 resource and Ec2 props as these are not yet defined in CDK
 * These classes abstract low level details from CloudFormation
 */
class Ec2InstanceProps {
  readonly image : ec2.IMachineImage;
  readonly instanceType : ec2.InstanceType;
  readonly userData : UserData;
  readonly subnet : ec2.ISubnet;
  readonly role : Role;
}
class Ec2 extends Resource {
  constructor(scope: cdk.Construct, id: string, props? : Ec2InstanceProps) {
    super(scope, id);

    if (props) {

      //create a profile to attch the role to the instance
      const profile = new CfnInstanceProfile(this, `${id}Profile`, {
        roles: [ props.role.roleName ]
      });

      // create the instance
      const instance = new ec2.CfnInstance(this, id, {
        imageId: props.image.getImage(this).imageId,
        instanceType: props.instanceType.toString(),
        networkInterfaces: [
          {
            deviceIndex: "0",
            subnetId: props.subnet.subnetId
          }
        ]
        ,userData: Fn.base64(props.userData.render())
        ,iamInstanceProfile: profile.ref
      });

      // tag the instance
      Tag.add(instance, 'Name', `${CodeStack.name}/${id}`);
      }
  }
}

export class CodeStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // create VPC w/ public and private subnets in 1 AZ
    // this also creates a NAT Gateway 
    // I am using 1 AZ because it's a demo.  In real life always use >=2
    const vpc = new ec2.Vpc(this, 'NewsBlogVPC', {
      maxAzs : 1
    });
    const privateSubnet0 = vpc.privateSubnets[0];

    // define the IAM role that will allow the EC2 instance to communicate with SSM 
    const role = new Role(this, 'NewsBlogRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com')
    });
    // arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    

    // define a user data script to install & launch our web server 
    const ssmaUserData = UserData.forLinux();
    // make sure the latest SSM Agent is installed.
    const SSM_AGENT_RPM='https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm';
    ssmaUserData.addCommands(`sudo yum install -y ${SSM_AGENT_RPM}`, 'restart amazon-ssm-agent');
    // install and start Nginx
    ssmaUserData.addCommands('yum install -y nginx', 'chkconfig nginx on', 'service nginx start');

    // launch an EC2 instance in the private subnet
    const instance = new Ec2(this, 'NewsBlogInstance', {
      image: new AmazonLinuxImage(),
      instanceType : ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      subnet : privateSubnet0,
      role: role,
      userData : ssmaUserData 
    })
  }
}