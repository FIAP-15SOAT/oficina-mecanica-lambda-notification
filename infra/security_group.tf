# No ingress rule: nothing connects to the function, which the queue event source
# mapping invokes through the platform. Egress reaches the internal NLB SMTP
# listener and the telemetry destination.
resource "aws_security_group" "secgrp_lambda" {
  name = local.secgrp_lambda_name
  # EC2 rejects a non-ASCII security group description
  description = "Egress for the email notification function"
  vpc_id      = local.vpc_id

  egress {
    description      = "Open egress: internal NLB SMTP and telemetry destination"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = local.secgrp_lambda_name
  }
}
